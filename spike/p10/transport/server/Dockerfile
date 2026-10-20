FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -o /transport-server .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 && rm -rf /var/lib/apt/lists/*
COPY --from=build /transport-server /usr/local/bin/transport-server
COPY static /srv/static
WORKDIR /srv
EXPOSE 9443/tcp 9443/udp
CMD ["transport-server", "-static", "/srv/static", "-cert", "/certs/server.crt", "-key", "/certs/server.key"]
