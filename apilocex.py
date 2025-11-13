import requests
import csv
import time

API_KEY = "AIzaSyDk2FcShzcZOPuU_Q9_GL8GLnyNBewvqjE"

# Uganda bounding box (approx)
min_lat, max_lat = -1.5, 4.3
min_lng, max_lng = 29.5, 35.0

radius = 50000  # max radius in meters
keyword = "Shell"
type_place = "gas_station"


def generate_grid(min_lat, max_lat, min_lng, max_lng, step):
    lat = min_lat
    while lat <= max_lat:
        lng = min_lng
        while lng <= max_lng:
            yield (lat, lng)
            lng += step
        lat += step


# step ~0.4 degrees ~ 44 km, overlapping circles
grid_points = list(generate_grid(min_lat, max_lat, min_lng, max_lng, 0.4))

results = []
seen_places = set()

url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"

for lat, lng in grid_points:
    print(f"Searching around: {lat},{lng}")
    params = {
        "key": API_KEY,
        "location": f"{lat},{lng}",
        "radius": radius,
        "keyword": keyword,
        "type": type_place,
    }

    while True:
        response = requests.get(url, params=params).json()
        for place in response.get("results", []):
            place_id = place["place_id"]
            if place_id in seen_places:
                continue
            seen_places.add(place_id)

            name = place.get("name")
            lat_p = place["geometry"]["location"]["lat"]
            lng_p = place["geometry"]["location"]["lng"]
            address = place.get("vicinity", "")
            results.append([name, lat_p, lng_p, address])
            print(name, lat_p, lng_p, address)

        next_page_token = response.get("next_page_token")
        if next_page_token:
            time.sleep(2)  # must wait before using next_page_token
            params["pagetoken"] = next_page_token
        else:
            break

# Save CSV
with open("shell_locations_uganda.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["Name", "Latitude", "Longitude", "Address"])
    writer.writerows(results)

print(f"Saved {len(results)} Shell stations to shell_locations_uganda.csv")
