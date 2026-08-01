apiVersion: v1
kind: ConfigMap
metadata:
  name: nebulatrace-config
  namespace: nebulatrace
data:
  DATABASE_URL: postgresql://nebulatrace:nebulatrace@postgres.nebulatrace-data:5432/nebulatrace
  ACTIVEMQ_HOST: activemq.nebulatrace-data
  ACTIVEMQ_STOMP_PORT: "61613"
  ACTIVEMQ_USER: admin
  ACTIVEMQ_PASSWORD: admin
  DEPLOYMENT_QUEUE: /queue/deployments.requested
  REDIS_URL: redis://redis.nebulatrace-data:6379
  ARTIFACT_URL: http://artifact-api:8080
  QUOTA_URL: http://quota-api:8080
  RELEASE_URL: http://release-api:8080
  INCIDENT_ASSISTANT_URL: http://incident-assistant:8080
  LLM_URL: http://mock-llm:8080
  AUDIT_URL: http://audit-api:8080
  RUNNER_ADDRESS: runner-agent:50051
  PLATFORM_URL: http://platform-api:8080
  SERVICE_VERSION: "${IMAGE_TAG}"
  OTEL_RESOURCE_ATTRIBUTES: "${OTEL_RESOURCE_ATTRIBUTES}"
  DT_CUSTOM_PROP: "${DT_CUSTOM_PROP}"
  DEMO_CONTROLS_ENABLED: "${DEMO_CONTROLS_ENABLED}"
  LOADGEN_DELAY_MS: "${LOADGEN_DELAY_MS}"
  LOADGEN_BURST: "${LOADGEN_BURST}"
  LOADGEN_ERROR_RATE: "${LOADGEN_ERROR_RATE}"
  WEBHOOK_DELAY_MS: "${WEBHOOK_DELAY_MS}"
  FAAS_PROVIDER: "${FAAS_PROVIDER}"
  FAAS_VERSION: "${FAAS_VERSION}"
  MEMORY_PRESSURE_MB: "${MEMORY_PRESSURE_MB}"
  MEMORY_SURVIVOR_BATCHES: "${MEMORY_SURVIVOR_BATCHES}"
  QUOTA_LIMIT: "${QUOTA_LIMIT}"
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: platform-api
  namespace: nebulatrace
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: platform-api-controls
  namespace: nebulatrace
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    resourceNames:
      - engineering-portal
      - platform-api
      - artifact-api
      - release-api
      - quota-api
      - deployment-worker
      - audit-api
      - incident-assistant
      - mock-llm
      - webhook-function
      - runner-agent
      - load-generator
    verbs: ["get", "patch"]
  - apiGroups: ["networking.istio.io"]
    resources: ["virtualservices"]
    resourceNames: ["quota-api"]
    verbs: ["get", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: platform-api-controls
  namespace: nebulatrace
subjects:
  - kind: ServiceAccount
    name: platform-api
    namespace: nebulatrace
roleRef:
  kind: Role
  name: platform-api-controls
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: platform-api-data-controls
  namespace: nebulatrace-data
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
  name: platform-api-data-controls
  namespace: nebulatrace-data
subjects:
  - kind: ServiceAccount
    name: platform-api
    namespace: nebulatrace
roleRef:
  kind: Role
  name: platform-api-data-controls
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: engineering-portal
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: engineering-portal}
  template:
    metadata:
      labels: {app: engineering-portal}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: engineering-portal
    spec:
      containers:
        - name: engineering-portal
          image: ${IMAGE_REGISTRY}/engineering-portal:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: engineering-portal
  namespace: nebulatrace
spec:
  selector: {app: engineering-portal}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: platform-api
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: platform-api}
  template:
    metadata:
      labels: {app: platform-api}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: platform-api
    spec:
      serviceAccountName: platform-api
      containers:
        - name: platform-api
          image: ${IMAGE_REGISTRY}/platform-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: platform-api
  namespace: nebulatrace
spec:
  selector: {app: platform-api}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: artifact-api
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: artifact-api}
  template:
    metadata:
      labels: {app: artifact-api}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: artifact-api
    spec:
      containers:
        - name: artifact-api
          image: ${IMAGE_REGISTRY}/artifact-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          env:
            - {name: SPRING_DATASOURCE_URL, value: "jdbc:postgresql://postgres.nebulatrace-data:5432/nebulatrace"}
            - {name: SPRING_DATASOURCE_USERNAME, value: nebulatrace}
            - {name: SPRING_DATASOURCE_PASSWORD, value: nebulatrace}
            - {name: SCENARIO_MODE, value: stable}
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
          resources:
            requests: {cpu: 100m, memory: 128Mi}
            limits: {memory: 1Gi}
---
apiVersion: v1
kind: Service
metadata:
  name: artifact-api
  namespace: nebulatrace
spec:
  selector: {app: artifact-api}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: release-api
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: release-api}
  template:
    metadata:
      labels: {app: release-api}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: release-api
    spec:
      containers:
        - name: release-api
          image: ${IMAGE_REGISTRY}/release-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: release-api
  namespace: nebulatrace
spec:
  selector: {app: release-api}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quota-api
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: quota-api, version: stable}
  template:
    metadata:
      labels: {app: quota-api, version: stable}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: quota-api
    spec:
      containers:
        - name: quota-api
          image: ${IMAGE_REGISTRY}/quota-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          env:
            - {name: SCENARIO_MODE, value: stable}
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: quota-api
  namespace: nebulatrace
spec:
  selector: {app: quota-api, version: stable}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: deployment-worker
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: deployment-worker}
  template:
    metadata:
      labels: {app: deployment-worker}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: deployment-worker
    spec:
      containers:
        - name: deployment-worker
          image: ${IMAGE_REGISTRY}/deployment-worker:${IMAGE_TAG}
          env:
            - {name: SCENARIO_MODE, value: stable}
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: audit-api
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: audit-api}
  template:
    metadata:
      labels: {app: audit-api}
      annotations:
        oneagent.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: audit-api
    spec:
      containers:
        - name: audit-api
          image: ${IMAGE_REGISTRY}/audit-api:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: audit-api
  namespace: nebulatrace
spec:
  selector: {app: audit-api}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: incident-assistant
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: incident-assistant}
  template:
    metadata:
      labels: {app: incident-assistant}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: incident-assistant
    spec:
      containers:
        - name: incident-assistant
          image: ${IMAGE_REGISTRY}/incident-assistant:${IMAGE_TAG}
          ports: [{containerPort: 8080}]
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: incident-assistant
  namespace: nebulatrace
spec:
  selector: {app: incident-assistant}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mock-llm
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: mock-llm}
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
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: mock-llm
  namespace: nebulatrace
spec:
  selector: {app: mock-llm}
  ports: [{name: http, port: 8080, targetPort: 8080}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webhook-function
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: webhook-function}
  template:
    metadata:
      labels: {app: webhook-function}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: webhook-function
    spec:
      containers:
        - name: webhook-function
          image: ${IMAGE_REGISTRY}/webhook-function:${IMAGE_TAG}
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: runner-agent
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: runner-agent}
  template:
    metadata:
      labels: {app: runner-agent}
      annotations:
        otlp-exporter-configuration.dynatrace.com/inject: "true"
        metadata.dynatrace.com/service: runner-agent
    spec:
      containers:
        - name: runner-agent
          image: ${IMAGE_REGISTRY}/runner-agent:${IMAGE_TAG}
          ports: [{containerPort: 50051}]
          env:
            - {name: SCENARIO_MODE, value: stable}
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
---
apiVersion: v1
kind: Service
metadata:
  name: runner-agent
  namespace: nebulatrace
spec:
  selector: {app: runner-agent}
  ports: [{name: grpc, port: 50051, targetPort: 50051}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: load-generator
  namespace: nebulatrace
spec:
  replicas: 1
  selector:
    matchLabels: {app: load-generator}
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
          envFrom: [{configMapRef: {name: nebulatrace-config}}]
