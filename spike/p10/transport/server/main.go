// P10 task 5: one server, two transports, same protocol.
//
//	WebTransport  https://HOST:9443/wt   HTTP/3 over UDP (quic-go/webtransport-go)
//	WebSocket     wss://HOST:9443/ws     HTTP/1.1 over TCP (coder/websocket)
//	static client https://HOST:9443/     (index.html, client.js)
//
// Frame: [type u8][seq u32][client ts f64][payload]. Types:
//
//	'P' ping       -> echoed back unchanged
//	'S' stream req -> payload = count u32, size u32; server replies with
//	                  `count` 'D' frames of `size` bytes, then one 'E' frame.
//
// WebSocket carries one frame per binary message. A WebTransport stream is a
// byte stream, so frames get a u32 length prefix there. Datagrams carry one
// frame each and are echoed ('P' only).
package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

const headerLen = 1 + 4 + 8

// respond handles one frame and writes the reply frame(s) with send.
func respond(frame []byte, send func([]byte) error) error {
	if len(frame) < headerLen {
		return errors.New("short frame")
	}
	switch frame[0] {
	case 'P':
		return send(frame)
	case 'S':
		if len(frame) < headerLen+8 {
			return errors.New("short stream request")
		}
		count := binary.BigEndian.Uint32(frame[headerLen:])
		size := binary.BigEndian.Uint32(frame[headerLen+4:])
		if count > 1_000_000 || size > 1<<20 {
			return errors.New("stream request too large")
		}
		data := make([]byte, headerLen+int(size))
		data[0] = 'D'
		copy(data[5:13], frame[5:13])
		for i := uint32(0); i < count; i++ {
			binary.BigEndian.PutUint32(data[1:5], i)
			if err := send(data); err != nil {
				return err
			}
		}
		end := make([]byte, headerLen)
		copy(end, frame[:headerLen])
		end[0] = 'E'
		return send(end)
	}
	return errors.New("unknown frame type")
}

func serveWebSocket(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"}, CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 21)
	ctx := r.Context()
	var mu sync.Mutex
	send := func(b []byte) error {
		mu.Lock()
		defer mu.Unlock()
		return c.Write(ctx, websocket.MessageBinary, b)
	}
	for {
		_, frame, err := c.Read(ctx)
		if err != nil {
			return
		}
		go func() {
			if err := respond(frame, send); err != nil {
				c.Close(websocket.StatusInternalError, err.Error())
			}
		}()
	}
}

func serveWebTransportStream(str *webtransport.Stream) {
	defer str.Close()
	rd := bufio.NewReader(str)
	var mu sync.Mutex
	send := func(b []byte) error {
		mu.Lock()
		defer mu.Unlock()
		var n [4]byte
		binary.BigEndian.PutUint32(n[:], uint32(len(b)))
		if _, err := str.Write(n[:]); err != nil {
			return err
		}
		_, err := str.Write(b)
		return err
	}
	for {
		var n [4]byte
		if _, err := io.ReadFull(rd, n[:]); err != nil {
			return
		}
		frame := make([]byte, binary.BigEndian.Uint32(n[:]))
		if _, err := io.ReadFull(rd, frame); err != nil {
			return
		}
		go respond(frame, send)
	}
}

func serveWebTransport(wt *webtransport.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, err := wt.Upgrade(w, r)
		if err != nil {
			log.Printf("wt upgrade: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		ctx := sess.Context()
		go func() { // datagram echo
			for {
				d, err := sess.ReceiveDatagram(ctx)
				if err != nil {
					return
				}
				if len(d) >= headerLen && d[0] == 'P' {
					_ = sess.SendDatagram(d)
				}
			}
		}()
		for {
			str, err := sess.AcceptStream(ctx)
			if err != nil {
				return
			}
			go serveWebTransportStream(str)
		}
	}
}

// netemArgs only allows the numeric options the benchmark needs.
var netemArgs = regexp.MustCompile(`^(delay [0-9.]+ms|rate [0-9.]+[mk]bit|loss [0-9.]+%| )*$`)

// serveNetem lets the benchmark container shape this container's egress
// (downstream to the browser). Only reachable inside the compose network.
func serveNetem(w http.ResponseWriter, r *http.Request) {
	args := r.URL.Query().Get("args")
	if !netemArgs.MatchString(args) {
		http.Error(w, "bad args", http.StatusBadRequest)
		return
	}
	// Reply first: with "loss 100%" the reply itself would be dropped.
	io.WriteString(w, "ok\n")
	w.(http.Flusher).Flush()
	go func() {
		time.Sleep(20 * time.Millisecond)
		if err := applyNetem("sport", strings.Fields(args)); err != nil {
			log.Printf("netem %q: %v", args, err)
		}
	}()
}

// applyNetem impairs only traffic on port 9443 (dir = "sport" on the server,
// "dport" on the client), so the control channel and ARP keep working even
// at "loss 100%". Same layout as bench/transport-bench.mjs.
func applyNetem(dir string, args []string) error {
	_ = exec.Command("tc", "qdisc", "del", "dev", "eth0", "root").Run()
	if len(args) == 0 {
		return nil
	}
	for _, c := range [][]string{
		{"qdisc", "add", "dev", "eth0", "root", "handle", "1:", "prio"},
		append([]string{"qdisc", "add", "dev", "eth0", "parent", "1:3", "handle", "30:", "netem"}, args...),
		{"filter", "add", "dev", "eth0", "parent", "1:0", "protocol", "ip", "u32", "match", "ip", dir, "9443", "0xffff", "flowid", "1:3"},
	} {
		if out, err := exec.Command("tc", c...).CombinedOutput(); err != nil {
			return fmt.Errorf("tc %v: %v %s", c, err, out)
		}
	}
	return nil
}

func main() {
	addr := flag.String("addr", ":9443", "TCP (HTTPS/WebSocket) and UDP (HTTP/3/WebTransport) address")
	ctlAddr := flag.String("ctl", ":9000", "plain-HTTP control address for netem (empty: disabled)")
	certFile := flag.String("cert", "certs/server.crt", "certificate (ECDSA, valid < 14 days)")
	keyFile := flag.String("key", "certs/server.key", "private key")
	static := flag.String("static", "static", "client files")
	flag.Parse()

	cert, err := tls.LoadX509KeyPair(*certFile, *keyFile)
	if err != nil {
		log.Fatal(err)
	}
	sum := sha256.Sum256(cert.Certificate[0])
	certHash := base64.StdEncoding.EncodeToString(sum[:])
	tlsConf := &tls.Config{Certificates: []tls.Certificate{cert}}

	h3 := &http3.Server{
		Addr:       *addr,
		TLSConfig:  http3.ConfigureTLSConfig(tlsConf),
		QUICConfig: &quic.Config{EnableDatagrams: true},
	}
	webtransport.ConfigureHTTP3Server(h3)
	wt := &webtransport.Server{H3: h3, CheckOrigin: func(*http.Request) bool { return true }}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir(*static)))
	mux.HandleFunc("/ws", serveWebSocket)
	mux.HandleFunc("/wt", serveWebTransport(wt))
	mux.HandleFunc("/cert-hash", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, certHash) })
	h3.Handler = mux

	if *ctlAddr != "" {
		go func() { log.Fatal(http.ListenAndServe(*ctlAddr, http.HandlerFunc(serveNetem))) }()
	}
	go func() {
		srv := &http.Server{Addr: *addr, Handler: mux, TLSConfig: tlsConf}
		log.Fatal(srv.ListenAndServeTLS("", ""))
	}()
	log.Printf("listening on %s (tcp+udp), cert sha256 %s", *addr, certHash)
	if err := wt.ListenAndServe(); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}
