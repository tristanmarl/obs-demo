FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/obs-edge-agent .

FROM scratch AS bin
COPY --from=build /out/obs-edge-agent /obs-edge-agent

FROM alpine:3.20
COPY --from=build /out/obs-edge-agent /obs-edge-agent
CMD ["/obs-edge-agent"]
