package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseInterval(t *testing.T) {
	for in, want := range map[string]time.Duration{"": 5 * time.Second, "bogus": 5 * time.Second, "-1s": 5 * time.Second, "2s": 2 * time.Second} {
		if got := parseInterval(in); got != want {
			t.Errorf("parseInterval(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestRequestBody(t *testing.T) {
	var job struct {
		Name      string `json:"name"`
		WorkUnits int    `json:"workUnits"`
	}
	if err := json.Unmarshal(requestBody(), &job); err != nil || job.Name != "edge-batch" || job.WorkUnits != 5 {
		t.Fatalf("unexpected body %s: %v", requestBody(), err)
	}
}
