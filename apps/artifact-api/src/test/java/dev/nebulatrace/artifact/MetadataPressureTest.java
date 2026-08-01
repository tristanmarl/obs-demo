package dev.nebulatrace.artifact;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MetadataPressureTest {
  @Test
  void retainsAtMostConfiguredBatchesAndResetClearsThem() {
    MetadataPressure pressure = new MetadataPressure(1, 2);
    List<Map<String, Object>> artifacts = List.of(Map.of("sku", "checkout", "name", "Checkout", "stock", 1));
    pressure.buildDependencyMetadataBatch(artifacts);
    pressure.buildDependencyMetadataBatch(artifacts);
    pressure.buildDependencyMetadataBatch(artifacts);
    assertEquals(2, pressure.retainedBatchCount());
    pressure.clear();
    assertEquals(0, pressure.retainedBatchCount());
  }
}
