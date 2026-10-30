apiVersion: v1
kind: Service
metadata:
  name: host-db
  namespace: traceforge
spec:
  ports:
    - {name: tcp-mysql, port: 3306, targetPort: 3306}
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: host-db
  namespace: traceforge
  labels:
    kubernetes.io/service-name: host-db
addressType: IPv4
ports:
  - {name: tcp-mysql, port: 3306, protocol: TCP}
endpoints:
  - addresses: ["${HOST_DB_IP}"]
