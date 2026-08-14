apiVersion: v1
kind: Secret
metadata:
  name: "${DYNAKUBE_NAME}"
  namespace: dynatrace
type: Opaque
stringData:
  apiToken: "${DT_API_TOKEN}"
  dataIngestToken: "${DT_DATA_INGEST_TOKEN}"
---
apiVersion: dynatrace.com/v1beta6
kind: DynaKube
metadata:
  name: "${DYNAKUBE_NAME}"
  namespace: dynatrace
  annotations:
    feature.dynatrace.com/automatic-injection: "false"
spec:
  apiUrl: "${DT_API_URL}/api"
  tokens: "${DYNAKUBE_NAME}"
  enableIstio: true
  metadataEnrichment:
    enabled: true
  logMonitoring: {}
  telemetryIngest:
    protocols:
      - otlp
  oneAgent:
    hostGroup: "${DT_HOST_GROUP}"
    applicationMonitoring:
      namespaceSelector:
        matchLabels:
          nebulatrace.dev/oneagent: "true"
  activeGate:
    capabilities:
      - kubernetes-monitoring
      - routing
      - dynatrace-api
    resources:
      requests:
        cpu: 500m
        memory: 1.5Gi
      limits:
        cpu: 1000m
        memory: 1.5Gi
  otlpExporterConfiguration:
    namespaceSelector:
      matchLabels:
        nebulatrace.dev/otel: "true"
    signals:
      metrics: {}
      traces: {}
      logs: {}
