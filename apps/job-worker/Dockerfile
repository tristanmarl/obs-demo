FROM python:3.12-slim
WORKDIR /app
COPY job-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY proto ./proto
RUN python -m grpc_tools.protoc -I proto --python_out=. --grpc_python_out=. proto/jobs.proto
COPY otel_setup.py flags.py ./
COPY job-worker/worker.py .
CMD ["python", "worker.py"]
