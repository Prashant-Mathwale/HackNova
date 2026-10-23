import math
import random
from datetime import datetime, timedelta

def generate_mixed_csv():
    # Base timestamp: 24/10/2026 10:00:00
    start_time = datetime(2026, 10, 24, 10, 0, 0)
    rows = []
    
    # Header
    header = "Date;Time;Global_active_power;Global_reactive_power;Voltage;Global_intensity;Sub_metering_1;Sub_metering_2;Sub_metering_3"
    rows.append(header)
    
    current_time = start_time
    total_minutes = 150 # 2.5 hours of readings
    
    for i in range(total_minutes):
        ts = current_time + timedelta(minutes=i)
        date_str = ts.strftime("%d/%m/%Y")
        time_str = ts.strftime("%H:%M:%S")
        
        # Scenario 1: Normal Morning Baseline (minutes 0 to 40) ~ 1.0 - 1.8 kW
        if i < 40:
            active = round(random.uniform(0.9, 1.6), 3)
            reactive = round(random.uniform(0.08, 0.18), 3)
            voltage = round(random.uniform(239.5, 242.5), 2)
            intensity = round((active * 1000) / voltage, 1)
            sub1 = 0
            sub2 = 0 if i % 2 == 0 else 1
            sub3 = 1 if i % 3 == 0 else 17
            
            # Introduce a missing optional value at minute 15 and 25
            if i == 15:
                sub2_str = "?"
            elif i == 25:
                reactive_str = "?"
            else:
                sub2_str = str(sub2)
                reactive_str = str(reactive)
            
            rows.append(f"{date_str};{time_str};{active};{reactive_str if i == 25 else reactive};{voltage};{intensity};{sub1};{sub2_str if i == 15 else sub2};{sub3}")

        # Scenario 2: High Demand Peak & Heavy Appliances (minutes 40 to 65) ~ 4.5 - 7.8 kW
        elif i < 65:
            # Huge spike around minutes 48 to 55
            if 48 <= i <= 55:
                active = round(random.uniform(6.5, 8.2), 3) # Extreme Peak!
                reactive = round(random.uniform(0.35, 0.65), 3)
                voltage = round(random.uniform(234.0, 237.5), 2) # Voltage sag under heavy load
                intensity = round((active * 1000) / voltage, 1)
                sub1 = random.randint(25, 38) # Kitchen oven
                sub2 = random.randint(30, 42) # Laundry dryer
                sub3 = random.randint(16, 20) # Water heater
            else:
                active = round(random.uniform(3.8, 5.2), 3)
                reactive = round(random.uniform(0.20, 0.35), 3)
                voltage = round(random.uniform(237.0, 239.5), 2)
                intensity = round((active * 1000) / voltage, 1)
                sub1 = random.randint(10, 20)
                sub2 = 1
                sub3 = 17
            rows.append(f"{date_str};{time_str};{active};{reactive};{voltage};{intensity};{sub1};{sub2};{sub3}")

        # Scenario 3: Extreme Statistical Anomaly (minutes 65 to 75)
        # Outlier with unusual reactive-to-active ratio or power burst
        elif i < 75:
            if i == 70 or i == 72:
                # Anomaly: very high power surge with massive reactive component
                active = 8.650
                reactive = 1.820
                voltage = 231.50
                intensity = 37.4
                sub1 = 45
                sub2 = 38
                sub3 = 18
            else:
                active = round(random.uniform(1.8, 2.5), 3)
                reactive = round(random.uniform(0.12, 0.22), 3)
                voltage = round(random.uniform(240.0, 242.0), 2)
                intensity = round((active * 1000) / voltage, 1)
                sub1 = 0
                sub2 = 2
                sub3 = 1
            rows.append(f"{date_str};{time_str};{active};{reactive};{voltage};{intensity};{sub1};{sub2};{sub3}")

        # Scenario 4: Clean, continuous 1-minute trajectory for Forecast validation (minutes 75 to 150)
        else:
            # Cyclic diurnal afternoon trend
            t = (i - 75) / 75.0 * math.pi
            active = round(1.4 + 0.8 * math.sin(t) + random.uniform(-0.15, 0.15), 3)
            reactive = round(random.uniform(0.10, 0.20), 3)
            voltage = round(random.uniform(240.5, 243.0), 2)
            intensity = round((active * 1000) / voltage, 1)
            sub1 = 0
            sub2 = 0
            sub3 = 17 if i % 2 == 0 else 1
            rows.append(f"{date_str};{time_str};{active};{reactive};{voltage};{intensity};{sub1};{sub2};{sub3}")

    # Insert an out-of-order / duplicate row to test Data Quality filtering
    # Insert a duplicate timestamp after minute 30
    dup_ts = (start_time + timedelta(minutes=30)).strftime("%d/%m/%Y;%H:%M:%S")
    # rows.insert(32, f"{dup_ts};1.200;0.100;240.00;5.0;0;0;0") # Will be skipped by backend parser

    content = "\n".join(rows) + "\n"
    with open("mixed_household_power.csv", "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Successfully generated mixed_household_power.csv with {len(rows)} lines.")

if __name__ == "__main__":
    generate_mixed_csv()
