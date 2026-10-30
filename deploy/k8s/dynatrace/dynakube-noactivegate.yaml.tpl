apiVersion: dynatrace.com/v1beta6
kind: DynaKube
metadata:
  name: traceforge
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
      - key: traceforge.dev/oneagent
        operator: Exists
  oneAgent:
    applicationMonitoring:
      namespaceSelector:
        matchLabels:
          traceforge.dev/oneagent: "true"
  otlpExporterConfiguration:
    namespaceSelector:
      matchLabels:
        traceforge.dev/otel: "true"
    signals:
      metrics: {}
      traces: {}
      logs: {}
