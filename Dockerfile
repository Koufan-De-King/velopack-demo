FROM mcr.microsoft.com/dotnet/sdk:8.0-noble

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    imagemagick \
    squashfs-tools \
    zstd \
  && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.dotnet/tools:${PATH}"
RUN dotnet tool install --global vpk

WORKDIR /workspace

CMD ["bash"]
