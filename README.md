# RAINWISE – Intelligent Rainwater Harvesting Monitoring and Decision Support System

Simple website + API for monitoring a rainwater tank (ESP32, rain sensor, HC-SR04).

## Folders
- `backend/`  FastAPI server and SQLite database (`main.py`)
- `frontend/` Website (HTML, CSS, JavaScript) – served by the backend
- `firmware/` ESP32 Arduino sketch

## Run the website
```
pip install -r requirements.txt
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```
Open http://localhost:8000. The database file `rainwise.db` is created automatically.

Optional: set your own key before starting (Windows: `set`, Linux/Mac: `export`):
`RAINWISE_API_KEY=my-secret-key`

## Connect the hardware
1. Open `firmware/rainwise_esp32.ino` in Arduino IDE (ESP32 board installed).
2. Set Wi-Fi name/password, `SERVER_URL` (your computer's local IP, e.g. `http://192.168.1.10:8000/api/readings`) and `API_KEY`.
3. Calibrate `RAIN_DRY` / `RAIN_WET` from the Serial Monitor.
4. Upload. Readings are sent every 60 seconds.
5. On the Dashboard, open **Tank setup** and enter tank height, capacity and the sensor gap (distance from sensor to water when the tank is full).

## Workflow Demo
Open the **Workflow Demo** page: press *Play storm demo* to watch a reading travel from the sensors to the website, or move the sliders. It runs in the browser and saves nothing.

## Demo data
With no reading in the last 10 minutes, the Dashboard and Tips show sample numbers labelled **DEMO DATA**. Demo data is never saved to the database. Live data replaces it automatically.

## Test without hardware
```
curl -X POST http://localhost:8000/api/readings -H "Content-Type: application/json" -H "X-API-Key: change-me" -d '{"rain_percent": 40, "distance_cm": 80}'
```

## Notes
- The rain sensor shows wetness (none/light/heavy), not millimetres. The Calculator uses rainfall you enter.
- Change the default API key before real use. Settings and "Mark as done" are open to anyone on your network; add a login if you host it publicly.
- API docs: http://localhost:8000/docs
