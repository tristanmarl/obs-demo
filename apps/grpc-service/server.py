import re
import os
import time
from concurrent import futures

import grpc
import jobs_pb2
import jobs_pb2_grpc
import otel_setup
from opentelemetry.instrumentation.grpc import GrpcInstrumentorServer

PORT = int(os.getenv("GRPC_PORT", "50051"))
otel_setup.setup("grpc-service")
GrpcInstrumentorServer().instrument()


class JobExecutor(jobs_pb2_grpc.JobExecutorServicer):
    def ValidateJob(self, request, context):
        accepted = bool(re.fullmatch(r"[a-z0-9._-]{1,80}", request.name)) and 1 <= request.work_units <= 100
        return jobs_pb2.ValidateJobReply(accepted=accepted, status="accepted" if accepted else "rejected", message="job input valid" if accepted else "job input invalid")

    def ExecuteJob(self, request, context):
        if os.getenv("SCENARIO_MODE") == "grpc-deadline":
            time.sleep(2)
        return jobs_pb2.ExecuteJobReply(healthy=True, status="executed", message="job executed")

    def VerifyJob(self, request, context):
        return jobs_pb2.VerifyJobReply(healthy=bool(request.job_id), status="verified" if request.job_id else "rejected", message="job verified" if request.job_id else "job id required")


def main():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    jobs_pb2_grpc.add_JobExecutorServicer_to_server(JobExecutor(), server)
    server.add_insecure_port(f"[::]:{PORT}")
    server.start()
    print({"event": "grpc-service.start", "port": PORT}, flush=True)
    server.wait_for_termination()


if __name__ == "__main__":
    main()
