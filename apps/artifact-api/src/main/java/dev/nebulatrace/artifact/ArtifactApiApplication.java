package dev.nebulatrace.artifact;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class ArtifactApiApplication {
  public static void main(String[] args) {
    SpringApplication.run(ArtifactApiApplication.class, args);
  }
}

record ArtifactMetadata(String sku, String name, int stock, byte[] payload) {}

final class MetadataPressure {
  private final int batchBytes;
  private final int maxBatches;
  // ponytail: one bounded process-local deque is enough for this demo; use an external profiler workload if concurrency matters.
  private final Deque<List<ArtifactMetadata>> retainedBatches = new ArrayDeque<>();

  MetadataPressure(int batchMb, int maxBatches) {
    batchBytes = Math.max(1, batchMb) * 1024 * 1024;
    this.maxBatches = Math.max(1, maxBatches);
  }

  synchronized int buildDependencyMetadataBatch(List<Map<String, Object>> artifacts) {
    List<ArtifactMetadata> batch = new ArrayList<>(artifacts.size());
    int payloadBytes = Math.max(1, batchBytes / Math.max(1, artifacts.size()));
    for (Map<String, Object> artifact : artifacts) {
      batch.add(new ArtifactMetadata(
          String.valueOf(artifact.get("sku")),
          String.valueOf(artifact.get("name")),
          ((Number) artifact.get("stock")).intValue(),
          new byte[payloadBytes]));
    }
    while (retainedBatches.size() >= maxBatches) retainedBatches.removeFirst();
    retainedBatches.addLast(batch);
    return retainedBatches.size();
  }

  synchronized void clear() {
    retainedBatches.clear();
  }

  synchronized int retainedBatchCount() {
    return retainedBatches.size();
  }
}

@RestController
class ArtifactController {
  private final JdbcTemplate jdbc;
  private final MetadataPressure metadataPressure = new MetadataPressure(
      boundedEnv("MEMORY_PRESSURE_MB", 4, 1, 32),
      boundedEnv("MEMORY_SURVIVOR_BATCHES", 8, 1, 16));

  ArtifactController(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @GetMapping("/healthz")
  Map<String, Object> health() {
    return Map.of("ok", true, "service", "artifact-api");
  }

  @GetMapping("/artifacts")
  List<Map<String, Object>> artifacts() {
    String mode = System.getenv().getOrDefault("SCENARIO_MODE", "stable");
    if ("database-latency".equals(mode)) jdbc.queryForObject("select 1 from pg_sleep(2)", Integer.class);
    List<Map<String, Object>> result = jdbc.queryForList("select sku, name, stock from artifacts order by sku limit 20");
    if ("allocation-pressure".equals(mode)) metadataPressure.buildDependencyMetadataBatch(result);
    else metadataPressure.clear();
    return result;
  }

  static int boundedEnv(String name, int fallback, int min, int max) {
    try {
      return Math.max(min, Math.min(max, Integer.parseInt(System.getenv().getOrDefault(name, String.valueOf(fallback)))));
    } catch (NumberFormatException ignored) {
      return fallback;
    }
  }
}
