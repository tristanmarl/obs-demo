FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod .
COPY go.sum .
COPY main.go .
RUN go build -o /out/cache-api .

FROM alpine:3.20
COPY --from=build /out/cache-api /cache-api
EXPOSE 8080
CMD ["/cache-api"]
