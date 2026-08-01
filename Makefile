-include .env
export

KUBECTL ?= kubectl
IMAGE_REGISTRY ?= nebulatrace
IMAGE_TAG ?= dev

SERVICES := engineering-portal platform-api artifact-api quota-api audit-api load-generator
SHARED_CTX_SERVICES := release-api deployment-worker webhook-function incident-assistant mock-llm runner-agent
ALL_SERVICES := $(SERVICES) $(SHARED_CTX_SERVICES)

.PHONY: build-images build test verify run-local stop-local push-images publish k3s-load-images k3s-deploy install-istio install-dynatrace deploy app-url status restart start stop set-owner reset

build-images:
	@for service in $(SERVICES); do docker build -t $(IMAGE_REGISTRY)/$$service:$(IMAGE_TAG) apps/$$service; done
	@for service in $(SHARED_CTX_SERVICES); do docker build -f apps/$$service/Dockerfile -t $(IMAGE_REGISTRY)/$$service:$(IMAGE_TAG) apps; done

build: build-images

test: verify

verify:
	@bash -n setup.sh scripts/*.sh
	@docker run --rm -v "$(PWD):/workspace" -w /workspace node:22-alpine sh -lc 'npm ci --prefix apps/platform-api --ignore-scripts && npm test --prefix apps/platform-api'
	@docker run --rm -v "$(PWD):/workspace" -w /workspace node:22-alpine sh -lc 'npm ci --prefix apps/engineering-portal --ignore-scripts && npm run build --prefix apps/engineering-portal'
	@docker run --rm -v "$(PWD):/workspace" -w /workspace/apps/quota-api golang:1.23-alpine go test ./
	@docker run --rm -v "$(PWD):/workspace" python:3.12-alpine python -m compileall -q /workspace/apps
	@docker build -f apps/artifact-api/Dockerfile apps/artifact-api
	@./scripts/render-install-yaml.sh --no-env
	@test -z "$$(rg -n '\$$\{[^}]+\}' deploy/dist/nebulatrace.yaml)"
	@$(MAKE) build-images

run-local: build-images
	./scripts/run-local-docker.sh

stop-local:
	./scripts/stop-local-docker.sh

push-images:
	@test "$(IMAGE_REGISTRY)" != "nebulatrace" || (echo "Set IMAGE_REGISTRY to a registry your cluster can pull from before pushing."; exit 1)
	@for service in $(ALL_SERVICES); do docker push $(IMAGE_REGISTRY)/$$service:$(IMAGE_TAG); done

publish: IMAGE_REGISTRY=ghcr.io/tristanmarl/nebulatrace
publish: IMAGE_TAG=latest
publish: build-images push-images
	./scripts/render-install-yaml.sh --no-env

k3s-load-images: IMAGE_REGISTRY=nebulatrace
k3s-load-images: IMAGE_TAG=dev
k3s-load-images: build-images
	./scripts/k3s-load-images.sh

k3s-deploy: IMAGE_REGISTRY=nebulatrace
k3s-deploy: IMAGE_TAG=dev
k3s-deploy: k3s-load-images install-istio deploy

install-istio:
	./scripts/install-istio.sh

install-dynatrace:
	./scripts/install-dynatrace-operator.sh

deploy:
	./scripts/deploy-demo.sh

app-url:
	$(KUBECTL) -n istio-system get svc istio-ingressgateway

status:
	./scripts/status.sh

restart:
	./scripts/restart-workloads.sh

start:
	./scripts/scale-demo.sh start

stop:
	./scripts/scale-demo.sh stop

set-owner:
	@test -n "$(OWNER)" || (echo "Usage: make set-owner OWNER=service-monitoring"; exit 1)
	./scripts/set-owner.sh "$(OWNER)"

reset:
	./scripts/reset-demo.sh
