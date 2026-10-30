FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/tf-edge-agent .

FROM scratch AS bin
COPY --from=build /out/tf-edge-agent /tf-edge-agent

FROM alpine:3.20
COPY --from=build /out/tf-edge-agent /tf-edge-agent
CMD ["/tf-edge-agent"]
