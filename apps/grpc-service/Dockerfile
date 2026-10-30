FROM python:3.12-slim
WORKDIR /app
COPY grpc-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY proto ./proto
RUN python -m grpc_tools.protoc -I proto --python_out=. --grpc_python_out=. proto/jobs.proto
COPY otel_setup.py ./
COPY grpc-service/server.py grpc-service/test_contract.py ./
RUN python -m unittest test_contract.py
EXPOSE 50051
CMD ["python", "server.py"]
