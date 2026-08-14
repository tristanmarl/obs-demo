apiVersion: dynatrace.com/v1beta6
kind: DynaKube
metadata:
  name: nebulatrace
  namespace: dynatrace
  annotations:
    feature.dynatrace.com/automatic-injection: "false"
spec:
  apiUrl: "${DT_API_URL}/api"
  tokens: tristan-mac
  metadataEnrichment:
    enabled: true
    namespaceSelector:
      matchExpressions:
      - key: nebulatrace.dev/oneagent
        operator: Exists
  oneAgent:
    applicationMonitoring:
      namespaceSelector:
        matchLabels:
          nebulatrace.dev/oneagent: "true"
  otlpExporterConfiguration:
    namespaceSelector:
      matchLabels:
        nebulatrace.dev/otel: "true"
    signals:
      metrics: {}
      traces: {}
      logs: {}
