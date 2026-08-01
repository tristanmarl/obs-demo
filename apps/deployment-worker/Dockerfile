FROM python:3.12-slim
WORKDIR /app
COPY deployment-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY proto ./proto
RUN python -m grpc_tools.protoc -I proto --python_out=. --grpc_python_out=. proto/runner.proto
COPY otel_setup.py .
COPY deployment-worker/worker.py .
CMD ["python", "worker.py"]
