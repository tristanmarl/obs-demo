import json
import os
import time
from concurrent import futures

import grpc
import otel_setup
from opentelemetry.instrumentation.grpc import GrpcInstrumentorServer

import runner_pb2
import runner_pb2_grpc

PORT = int(os.getenv("RUNNER_PORT", "50051"))
otel_setup.setup("runner-agent")
GrpcInstrumentorServer().instrument()


class Runner(runner_pb2_grpc.RunnerServicer):
    def ExecuteRelease(self, request, context):
        print(json.dumps({"event": "runner-agent.execute", "release_id": request.release_id, "service": request.service}), flush=True)
        if os.getenv("SCENARIO_MODE") == "runner-deadline":
            time.sleep(2)
        return runner_pb2.ExecuteReleaseReply(status="succeeded", message="release executed")


def main():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    runner_pb2_grpc.add_RunnerServicer_to_server(Runner(), server)
    server.add_insecure_port(f"[::]:{PORT}")
    server.start()
    print(json.dumps({"event": "runner-agent.start", "port": PORT}), flush=True)
    server.wait_for_termination()


if __name__ == "__main__":
    main()
