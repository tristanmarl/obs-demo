import unittest

import jobs_pb2
from server import JobExecutor


class JobExecutorContractTest(unittest.TestCase):
    def test_rejects_invalid_and_runs_three_methods(self):
        executor = JobExecutor()
        rejected = executor.ValidateJob(jobs_pb2.JobRequest(name="bad name", work_units=10), None)
        self.assertFalse(rejected.accepted)
        request = jobs_pb2.JobRequest(job_id="job-1", name="demo-job", work_units=10)
        self.assertTrue(executor.ValidateJob(request, None).accepted)
        self.assertTrue(executor.ExecuteJob(request, None).healthy)
        self.assertTrue(executor.VerifyJob(jobs_pb2.VerifyJobRequest(job_id="job-1"), None).healthy)


if __name__ == "__main__":
    unittest.main()
