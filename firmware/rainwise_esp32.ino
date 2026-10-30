// RAINWISE ESP32 firmware: rain sensor + HC-SR04 -> Wi-Fi -> RAINWISE server
// Wiring:
//   Rain sensor AO -> GPIO34 (VCC 3.3V, GND)
//   HC-SR04 TRIG -> GPIO5, ECHO -> GPIO18 through a voltage divider (1k + 2k)
//   because HC-SR04 ECHO is 5V and the ESP32 pins are 3.3V. Power HC-SR04 from VIN (5V).
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID  = "YOUR_WIFI_NAME";
const char* WIFI_PASS  = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://192.168.1.10:8000/api/readings"; // your computer's local IP
const char* API_KEY    = "change-me";                             // same as RAINWISE_API_KEY

const int RAIN_PIN = 34, TRIG_PIN = 5, ECHO_PIN = 18;
const int RAIN_DRY = 4095;  // analog value when sensor is dry (calibrate)
const int RAIN_WET = 1200;  // analog value when sensor is fully wet (calibrate)
const unsigned long SEND_EVERY_MS = 60000;

float readDistanceCm() {
  float v[5]; int n = 0;
  for (int i = 0; i < 5; i++) {
    digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long us = pulseIn(ECHO_PIN, HIGH, 30000);
    if (us > 0) v[n++] = us * 0.0343f / 2.0f;
    delay(60);
  }
  if (n == 0) return -1;
  for (int i = 0; i < n - 1; i++)            // sort, then take the middle value
    for (int j = i + 1; j < n; j++) if (v[j] < v[i]) { float t = v[i]; v[i] = v[j]; v[j] = t; }
  return v[n / 2];
}

float readRainPercent() {
  int raw = analogRead(RAIN_PIN);
  return constrain(map(raw, RAIN_DRY, RAIN_WET, 0, 100), 0, 100);
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(500);
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  connectWifi();
}

void loop() {
  connectWifi();
  float dist = readDistanceCm();
  float rain = readRainPercent();
  if (dist > 0 && WiFi.status() == WL_CONNECTED) {
    char body[96];
    snprintf(body, sizeof(body), "{\"rain_percent\":%.1f,\"distance_cm\":%.1f}", rain, dist);
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-API-Key", API_KEY);
    int code = http.POST(body);
    Serial.printf("Sent %s -> HTTP %d\n", body, code);
    http.end();
  } else {
    Serial.println("Skipped: no valid distance or no Wi-Fi");
  }
  delay(SEND_EVERY_MS);
}
