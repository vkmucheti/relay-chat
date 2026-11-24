FROM golang:1.24.8-alpine3.22 AS build
ADD --checksum=sha256:be6d0bd3696c3a13a35f02d3a0280b64319c67918b4501c5c3d87f96d000085c https://codeload.github.com/minio/minio/tar.gz/refs/tags/RELEASE.2025-10-15T17-29-55Z /tmp/minio.tar.gz
WORKDIR /src
RUN tar -xzf /tmp/minio.tar.gz --strip-components=1
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/minio .

FROM alpine:3.22.2
RUN mkdir -p /data && chown 10001:10001 /data
COPY --from=build /out/minio /usr/local/bin/minio
ENV HOME=/tmp
USER 10001:10001
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
