apiVersion: dynatrace.com/v1beta6
kind: DynaKube
metadata:
  name: obs-demo
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
      - key: obs-demo.dev/oneagent
        operator: Exists
  oneAgent:
    applicationMonitoring:
      namespaceSelector:
        matchLabels:
          obs-demo.dev/oneagent: "true"
  otlpExporterConfiguration:
    namespaceSelector:
      matchLabels:
        obs-demo.dev/otel: "true"
    signals:
      metrics: {}
      traces: {}
      logs: {}
