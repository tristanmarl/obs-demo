package dev.obsdemo.catalog;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MetadataPressureTest {
  @Test
  void retainsAtMostConfiguredBatchesAndResetClearsThem() {
    CatalogMemoryPressure pressure = new CatalogMemoryPressure(1, 2);
    List<Map<String, Object>> catalog = List.of(Map.of("id", "item-a", "name", "Item A", "value", 1));
    pressure.buildCatalogBatch(catalog);
    pressure.buildCatalogBatch(catalog);
    pressure.buildCatalogBatch(catalog);
    assertEquals(2, pressure.retainedBatchCount());
    pressure.clear();
    assertEquals(0, pressure.retainedBatchCount());
  }
}
