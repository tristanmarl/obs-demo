FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod .
COPY go.sum .
COPY main.go .
RUN go build -o /out/quota-api .

FROM alpine:3.20
COPY --from=build /out/quota-api /quota-api
EXPOSE 8080
CMD ["/quota-api"]
