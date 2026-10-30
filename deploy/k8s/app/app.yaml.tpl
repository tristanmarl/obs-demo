apiVersion: v1
kind: ConfigMap
metadata:
  name: traceforge-config
  namespace: traceforge
data:
  DATABASE_URL: postgresql://traceforge:traceforge@postgres.traceforge-data:5432/traceforge
  ACTIVEMQ_HOST: activemq.traceforge-data
  ACTIVEMQ_STOMP_PORT: "61613"
  ACTIVEMQ_USER: admin
  ACTIVEMQ_PASSWORD: admin
  JOB_QUEUE: /queue/jobs.requested
  REDIS_URL: redis://redis.traceforge-data:6379
  CATALOG_URL: http://catalog-api:8080
  CACHE_URL: http://cache-api:8080
  JOB_URL: http://job-api:8080
  ANALYSIS_URL: http://analysis-api:8080
  LLM_URL: http://mock-llm:8080
  RESULT_URL: http://result-api:8080
  GRPC_ADDRESS: grpc-service:50051
  GATEWAY_URL: http://gateway-api:8080
  SERVICE_VERSION: "${IMAGE_TAG}"
  OTEL_RESOURCE_ATTRIBUTES: "${OTEL_RESOURCE_ATTRIBUTES}"
  DT_CUSTOM_PROP: "${DT_CUSTOM_PROP}"
  DEMO_CONTROLS_ENABLED: "${DEMO_CONTROLS_ENABLED}"
  LOADGEN_DELAY_MS: "${LOADGEN_DELAY_MS}"
  LOADGEN_BURST: "${LOADGEN_BURST}"
  LOADGEN_ERROR_RATE: "${LOADGEN_ERROR_RATE}"
  FAAS_VERSION: "${FAAS_VERSION}"
  MEMORY_PRESSURE_MB: "${MEMORY_PRESSURE_MB}"
  MEMORY_SURVIVOR_BATCHES: "${MEMORY_SURVIVOR_BATCHES}"
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gateway-api
  namespace: traceforge
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: gateway-api-controls
  namespace: traceforge
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    resourceNames:
      - control-ui
      - gateway-api
      - catalog-api
      - job-api
      - cache-api
      - job-worker
      - result-api
      - analysis-api
      - mock-llm
      - aws-lambda-trigger
      - azure-functions-trigger
      - google-cloud-function-trigger
      - grpc-service
      - load-generator
      - cache-exporter
      - queue-exporter
    verbs: ["get", "patch"]
  - apiGroups: ["networking.istio.io"]
    resources: ["virtualservices"]
    resourceNames: ["cache-api"]
    verbs: ["get", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: gateway-api-controls
  namespace: traceforge
subjects:
  - kind: ServiceAccount
    name: gateway-api
    namespace: traceforge
roleRef:
  kind: Role
  name: gateway-api-controls
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: gateway-api-data-controls
  namespace: traceforge-data
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    resourceNames: ["redis"]
    verbs: ["get", "patch"]
  - apiGroups: ["apps"]
    resources: ["statefulsets"]
    resourceNames: ["postgres", "activemq"]
    verbs: ["get", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: gateway-api-data-controls
  namespace: traceforge-data
subjects:
  - kind: ServiceAccount
    name: gateway-api
    namespace: traceforge
roleRef:
  kind: Role
  name: gateway-api-data-controls
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: control-ui
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: control-ui}}
  template:
    metadata:
      labels: {app: control-ui}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: control-ui
    spec:
      containers:
        - name: control-ui
          image: ${IMAGE_REGISTRY}/control-ui:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: control-ui
  namespace: traceforge
spec:
  selector: {app: control-ui}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway-api
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: gateway-api}}
  template:
    metadata:
      labels: {app: gateway-api}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: gateway-api
    spec:
      serviceAccountName: gateway-api
      containers:
        - name: gateway-api
          image: ${IMAGE_REGISTRY}/gateway-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: gateway-api
  namespace: traceforge
spec:
  selector: {app: gateway-api}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog-api
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: catalog-api}}
  template:
    metadata:
      labels: {app: catalog-api}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: catalog-api
    spec:
      containers:
        - name: catalog-api
          image: ${IMAGE_REGISTRY}/catalog-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          env:
            - {name: SPRING_DATASOURCE_URL, value: "jdbc:postgresql://postgres.traceforge-data:5432/traceforge"}
            - {name: SPRING_DATASOURCE_USERNAME, value: traceforge}
            - {name: SPRING_DATASOURCE_PASSWORD, value: traceforge}
            - {name: SCENARIO_MODE, value: stable}
          envFrom: [{configMapRef: {name: traceforge-config}}]
          resources:
            requests: {cpu: 100m, memory: 128Mi}
            limits: {memory: 1Gi}
---
apiVersion: v1
kind: Service
metadata:
  name: catalog-api
  namespace: traceforge
spec:
  selector: {app: catalog-api}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: job-api
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: job-api}}
  template:
    metadata:
      labels: {app: job-api}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: job-api
    spec:
      containers:
        - name: job-api
          image: ${IMAGE_REGISTRY}/job-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: job-api
  namespace: traceforge
spec:
  selector: {app: job-api}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cache-api
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: cache-api, version: stable}}
  template:
    metadata:
      labels: {app: cache-api, version: stable}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: cache-api
    spec:
      containers:
        - name: cache-api
          image: ${IMAGE_REGISTRY}/cache-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          env:
            - {name: SCENARIO_MODE, value: stable}
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: cache-api
  namespace: traceforge
spec:
  selector: {app: cache-api, version: stable}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: job-worker
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: job-worker}}
  template:
    metadata:
      labels: {app: job-worker}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: job-worker
    spec:
      containers:
        - name: job-worker
          image: ${IMAGE_REGISTRY}/job-worker:${IMAGE_TAG}
          env:
            - {name: SCENARIO_MODE, value: stable}
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: result-api
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: result-api}}
  template:
    metadata:
      labels: {app: result-api}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: result-api
    spec:
      containers:
        - name: result-api
          image: ${IMAGE_REGISTRY}/result-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: result-api
  namespace: traceforge
spec:
  selector: {app: result-api}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: analysis-api
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: analysis-api}}
  template:
    metadata:
      labels: {app: analysis-api}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: analysis-api
    spec:
      containers:
        - name: analysis-api
          image: ${IMAGE_REGISTRY}/analysis-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: analysis-api
  namespace: traceforge
spec:
  selector: {app: analysis-api}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mock-llm
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: mock-llm}}
  template:
    metadata:
      labels: {app: mock-llm}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: mock-llm
    spec:
      containers:
        - name: mock-llm
          image: ${IMAGE_REGISTRY}/mock-llm:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          env:
            - {name: SCENARIO_MODE, value: stable}
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: mock-llm
  namespace: traceforge
spec:
  selector: {app: mock-llm}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aws-lambda-trigger
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: aws-lambda-trigger}}
  template:
    metadata:
      labels: {app: aws-lambda-trigger}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: aws-lambda-trigger
    spec:
      containers:
        - name: aws-lambda-trigger
          image: ${IMAGE_REGISTRY}/function-trigger:${IMAGE_TAG}
          env:
            - {name: SERVICE_NAME, value: aws-lambda-trigger}
            - {name: FAAS_FUNCTION_NAME, value: aws-lambda-trigger}
            - {name: FAAS_PROVIDER, value: aws}
            - {name: TRIGGER_DELAY_MS, value: "6500"}
            - {name: CLOUD_REGION, value: us-east-1}
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: azure-functions-trigger
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: azure-functions-trigger}}
  template:
    metadata:
      labels: {app: azure-functions-trigger}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: azure-functions-trigger
    spec:
      containers:
        - name: azure-functions-trigger
          image: ${IMAGE_REGISTRY}/function-trigger:${IMAGE_TAG}
          env:
            - {name: SERVICE_NAME, value: azure-functions-trigger}
            - {name: FAAS_FUNCTION_NAME, value: azure-functions-trigger}
            - {name: FAAS_PROVIDER, value: azure}
            - {name: TRIGGER_DELAY_MS, value: "7500"}
            - {name: CLOUD_REGION, value: westeurope}
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: google-cloud-function-trigger
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: google-cloud-function-trigger}}
  template:
    metadata:
      labels: {app: google-cloud-function-trigger}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: google-cloud-function-trigger
    spec:
      containers:
        - name: google-cloud-function-trigger
          image: ${IMAGE_REGISTRY}/function-trigger:${IMAGE_TAG}
          env:
            - {name: SERVICE_NAME, value: google-cloud-function-trigger}
            - {name: FAAS_FUNCTION_NAME, value: google-cloud-function-trigger}
            - {name: FAAS_PROVIDER, value: gcp}
            - {name: TRIGGER_DELAY_MS, value: "8500"}
            - {name: CLOUD_REGION, value: europe-west3}
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grpc-service
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: grpc-service}}
  template:
    metadata:
      labels: {app: grpc-service}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: grpc-service
    spec:
      containers:
        - name: grpc-service
          image: ${IMAGE_REGISTRY}/grpc-service:${IMAGE_TAG}
          ports: [{name: grpc, containerPort: 50051}]
          env:
            - {name: SCENARIO_MODE, value: stable}
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: grpc-service
  namespace: traceforge
spec:
  selector: {app: grpc-service}
  ports: [{name: grpc, port: 50051, targetPort: 50051}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: load-generator
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: load-generator}}
  template:
    metadata:
      labels: {app: load-generator}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: load-generator
    spec:
      containers:
        - name: load-generator
          image: ${IMAGE_REGISTRY}/load-generator:${IMAGE_TAG}
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cache-exporter
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: cache-exporter}}
  template:
    metadata:
      labels: {app: cache-exporter}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: cache-exporter
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: /metrics
        metrics.dynatrace.com/scrape: "true"
        metrics.dynatrace.com/port: "15020"
        metrics.dynatrace.com/path: /stats/prometheus
        metrics.dynatrace.com/filter: '{"mode": "include", "names": ["traceforge_*"]}'
    spec:
      containers:
        - name: cache-exporter
          image: ${IMAGE_REGISTRY}/cache-exporter:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: traceforge-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: cache-exporter
  namespace: traceforge
spec:
  selector: {app: cache-exporter}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: queue-exporter
  namespace: traceforge
spec:
  replicas: 1
  selector: {matchLabels: {app: queue-exporter}}
  template:
    metadata:
      labels: {app: queue-exporter}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: queue-exporter
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: /metrics
        metrics.dynatrace.com/scrape: "true"
        metrics.dynatrace.com/port: "15020"
        metrics.dynatrace.com/path: /stats/prometheus
        metrics.dynatrace.com/filter: '{"mode": "include", "names": ["traceforge_*"]}'
    spec:
      containers:
        - name: queue-exporter
          image: ${IMAGE_REGISTRY}/queue-exporter:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: traceforge-config}}]
