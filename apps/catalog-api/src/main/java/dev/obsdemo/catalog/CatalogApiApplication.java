package dev.obsdemo.catalog;

import dev.openfeature.contrib.hooks.otel.TracesHook;
import dev.openfeature.contrib.providers.flagd.FlagdOptions;
import dev.openfeature.contrib.providers.flagd.FlagdProvider;
import dev.openfeature.sdk.Client;
import dev.openfeature.sdk.OpenFeatureAPI;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@SpringBootApplication
public class CatalogApiApplication {
  public static void main(String[] args) {
    SpringApplication.run(CatalogApiApplication.class, args);
  }
}

record CatalogEntry(String id, String name, int value, byte[] payload) {}

final class CatalogMemoryPressure {
  private final int batchBytes;
  private final int maxBatches;
  // ponytail: one bounded process-local deque is enough for this demo; use an external profiler workload if concurrency matters.
  private final Deque<List<CatalogEntry>> retainedBatches = new ArrayDeque<>();

  CatalogMemoryPressure(int pressureMb, int survivorBatches) {
    batchBytes = Math.max(1, pressureMb) * 1024 * 1024;
    maxBatches = Math.max(1, survivorBatches);
  }

  synchronized int buildCatalogBatch(List<Map<String, Object>> catalog) {
    List<CatalogEntry> batch = new ArrayList<>(catalog.size());
    int payloadBytes = Math.max(1, batchBytes / Math.max(1, catalog.size()));
    for (Map<String, Object> item : catalog) {
      batch.add(new CatalogEntry(
          String.valueOf(item.get("id")), String.valueOf(item.get("name")),
          ((Number) item.get("value")).intValue(), new byte[payloadBytes]));
    }
    while (retainedBatches.size() >= maxBatches) retainedBatches.removeFirst();
    retainedBatches.addLast(batch);
    return retainedBatches.size();
  }

  synchronized void clear() { retainedBatches.clear(); }

  synchronized int retainedBatchCount() { return retainedBatches.size(); }
}

@RestController
class CatalogController {
  private final JdbcTemplate jdbc;
  private final CatalogMemoryPressure memoryPressure = new CatalogMemoryPressure(
      boundedEnv("MEMORY_PRESSURE_MB", 4, 1, 32), boundedEnv("MEMORY_SURVIVOR_BATCHES", 8, 1, 16));

  private final Client flags = featureFlags();

  CatalogController(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  // Scenario flags come from flagd; any evaluation error falls back to false (stable behavior).
  private static Client featureFlags() {
    OpenFeatureAPI api = OpenFeatureAPI.getInstance();
    api.setProvider(new FlagdProvider(FlagdOptions.builder().host(System.getenv().getOrDefault("FLAGD_HOST", "flagd")).port(8013).build()));
    api.addHooks(new TracesHook());
    return api.getClient("catalog-api");
  }

  private boolean flag(String key) {
    try { return flags.getBooleanValue(key, false); } catch (RuntimeException ignored) { return false; }
  }

  @GetMapping("/healthz")
  Map<String, Object> health() { return Map.of("ok", true, "service", "catalog-api"); }

  @GetMapping("/catalog")
  List<Map<String, Object>> list() {
    if (flag("database-latency")) {
      jdbc.queryForObject("select 1 from pg_sleep(2)", Integer.class);
    }
    List<Map<String, Object>> result = jdbc.queryForList("select id, name, value from catalog_items order by id limit 20");
    if (flag("allocation-pressure")) memoryPressure.buildCatalogBatch(result);
    else memoryPressure.clear();
    return result;
  }

  @GetMapping("/catalog/{id}")
  Map<String, Object> detail(@PathVariable("id") String id) {
    if (!id.matches("[a-z0-9._-]{1,80}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "catalog id is invalid");
    List<Map<String, Object>> result = jdbc.queryForList("select id, name, value from catalog_items where id = ?", id);
    if (result.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "catalog item not found");
    return result.getFirst();
  }

  static int boundedEnv(String name, int fallback, int min, int max) {
    try { return Math.max(min, Math.min(max, Integer.parseInt(System.getenv().getOrDefault(name, String.valueOf(fallback))))); }
    catch (NumberFormatException ignored) { return fallback; }
  }
}
