/**
 * Static airport dataset.
 *
 * NOTE ON SCALE: This ships with ~180 real major/mid-size airports (accurate IATA
 * codes, city/country, and approximate lat/long good enough for nearby-airport
 * distance ranking). This is intentionally a curated "major routes" set rather
 * than the full ICAO database (~9000+ airports worldwide) — adding the rest is
 * a data-loading task, not an architecture change: see loadFromCsv() below for
 * how to extend this to a full dataset (e.g. OpenFlights airports.csv) later
 * without touching any service/controller code.
 *
 * rank_score: 0-100, higher = bigger/more important hub. Used to prioritize
 * which nearby airports to expand to when MAX_NEARBY_AIRPORTS caps the list.
 */

const AIRPORTS = [
  // ---------------- INDIA (priority coverage — primary market) ----------------
  { iata: 'DEL', name: 'Indira Gandhi International Airport', city: 'New Delhi', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 28.5562, lon: 77.1000, timezone: 'Asia/Kolkata', rank: 95 },
  { iata: 'BOM', name: 'Chhatrapati Shivaji Maharaj International Airport', city: 'Mumbai', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 19.0896, lon: 72.8656, timezone: 'Asia/Kolkata', rank: 93 },
  { iata: 'BLR', name: 'Kempegowda International Airport', city: 'Bengaluru', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 13.1986, lon: 77.7066, timezone: 'Asia/Kolkata', rank: 88 },
  { iata: 'MAA', name: 'Chennai International Airport', city: 'Chennai', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 12.9941, lon: 80.1709, timezone: 'Asia/Kolkata', rank: 82 },
  { iata: 'HYD', name: 'Rajiv Gandhi International Airport', city: 'Hyderabad', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 17.2403, lon: 78.4294, timezone: 'Asia/Kolkata', rank: 82 },
  { iata: 'CCU', name: 'Netaji Subhas Chandra Bose International Airport', city: 'Kolkata', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 22.6547, lon: 88.4467, timezone: 'Asia/Kolkata', rank: 78 },
  { iata: 'COK', name: 'Cochin International Airport', city: 'Kochi', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 10.1520, lon: 76.4019, timezone: 'Asia/Kolkata', rank: 68 },
  { iata: 'AMD', name: 'Sardar Vallabhbhai Patel International Airport', city: 'Ahmedabad', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 23.0772, lon: 72.6347, timezone: 'Asia/Kolkata', rank: 65 },
  { iata: 'PNQ', name: 'Pune Airport', city: 'Pune', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 18.5822, lon: 73.9197, timezone: 'Asia/Kolkata', rank: 62 },
  { iata: 'GOI', name: 'Goa International Airport (Dabolim)', city: 'Goa', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 15.3808, lon: 73.8314, timezone: 'Asia/Kolkata', rank: 60 },
  { iata: 'JAI', name: 'Jaipur International Airport', city: 'Jaipur', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 26.8242, lon: 75.8122, timezone: 'Asia/Kolkata', rank: 55 },
  { iata: 'LKO', name: 'Chaudhary Charan Singh International Airport', city: 'Lucknow', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 26.7606, lon: 80.8893, timezone: 'Asia/Kolkata', rank: 52 },
  { iata: 'IXC', name: 'Chandigarh International Airport', city: 'Chandigarh', country: 'India', countryCode: 'IN', region: 'South Asia', lat: 30.6735, lon: 76.7885, timezone: 'Asia/Kolkata', rank: 48 },

  // ---------------- SOUTH ASIA (rest) ----------------
  { iata: 'CMB', name: 'Bandaranaike International Airport', city: 'Colombo', country: 'Sri Lanka', countryCode: 'LK', region: 'South Asia', lat: 7.1808, lon: 79.8841, timezone: 'Asia/Colombo', rank: 60 },
  { iata: 'KTM', name: 'Tribhuvan International Airport', city: 'Kathmandu', country: 'Nepal', countryCode: 'NP', region: 'South Asia', lat: 27.6966, lon: 85.3591, timezone: 'Asia/Kathmandu', rank: 55 },
  { iata: 'DAC', name: 'Hazrat Shahjalal International Airport', city: 'Dhaka', country: 'Bangladesh', countryCode: 'BD', region: 'South Asia', lat: 23.8433, lon: 90.3978, timezone: 'Asia/Dhaka', rank: 62 },
  { iata: 'MLE', name: 'Velana International Airport', city: 'Malé', country: 'Maldives', countryCode: 'MV', region: 'South Asia', lat: 4.1918, lon: 73.5290, timezone: 'Indian/Maldives', rank: 58 },
  { iata: 'ISB', name: 'Islamabad International Airport', city: 'Islamabad', country: 'Pakistan', countryCode: 'PK', region: 'South Asia', lat: 33.5606, lon: 72.8355, timezone: 'Asia/Karachi', rank: 58 },
  { iata: 'KHI', name: 'Jinnah International Airport', city: 'Karachi', country: 'Pakistan', countryCode: 'PK', region: 'South Asia', lat: 24.9065, lon: 67.1608, timezone: 'Asia/Karachi', rank: 60 },

  // ---------------- SOUTHEAST ASIA ----------------
  { iata: 'SIN', name: 'Singapore Changi Airport', city: 'Singapore', country: 'Singapore', countryCode: 'SG', region: 'Southeast Asia', lat: 1.3644, lon: 103.9915, timezone: 'Asia/Singapore', rank: 98 },
  { iata: 'BKK', name: 'Suvarnabhumi Airport', city: 'Bangkok', country: 'Thailand', countryCode: 'TH', region: 'Southeast Asia', lat: 13.6900, lon: 100.7501, timezone: 'Asia/Bangkok', rank: 90 },
  { iata: 'DMK', name: 'Don Mueang International Airport', city: 'Bangkok', country: 'Thailand', countryCode: 'TH', region: 'Southeast Asia', lat: 13.9126, lon: 100.6068, timezone: 'Asia/Bangkok', rank: 70 },
  { iata: 'KUL', name: 'Kuala Lumpur International Airport', city: 'Kuala Lumpur', country: 'Malaysia', countryCode: 'MY', region: 'Southeast Asia', lat: 2.7456, lon: 101.7099, timezone: 'Asia/Kuala_Lumpur', rank: 85 },
  { iata: 'CGK', name: 'Soekarno-Hatta International Airport', city: 'Jakarta', country: 'Indonesia', countryCode: 'ID', region: 'Southeast Asia', lat: -6.1256, lon: 106.6559, timezone: 'Asia/Jakarta', rank: 82 },
  { iata: 'DPS', name: 'Ngurah Rai International Airport', city: 'Denpasar (Bali)', country: 'Indonesia', countryCode: 'ID', region: 'Southeast Asia', lat: -8.7482, lon: 115.1672, timezone: 'Asia/Makassar', rank: 78 },
  { iata: 'MNL', name: 'Ninoy Aquino International Airport', city: 'Manila', country: 'Philippines', countryCode: 'PH', region: 'Southeast Asia', lat: 14.5086, lon: 121.0198, timezone: 'Asia/Manila', rank: 78 },
  { iata: 'SGN', name: 'Tan Son Nhat International Airport', city: 'Ho Chi Minh City', country: 'Vietnam', countryCode: 'VN', region: 'Southeast Asia', lat: 10.8188, lon: 106.6520, timezone: 'Asia/Ho_Chi_Minh', rank: 75 },
  { iata: 'HAN', name: 'Noi Bai International Airport', city: 'Hanoi', country: 'Vietnam', countryCode: 'VN', region: 'Southeast Asia', lat: 21.2212, lon: 105.8072, timezone: 'Asia/Ho_Chi_Minh', rank: 72 },
  { iata: 'RGN', name: 'Yangon International Airport', city: 'Yangon', country: 'Myanmar', countryCode: 'MM', region: 'Southeast Asia', lat: 16.9073, lon: 96.1332, timezone: 'Asia/Yangon', rank: 55 },
  { iata: 'PNH', name: 'Phnom Penh International Airport', city: 'Phnom Penh', country: 'Cambodia', countryCode: 'KH', region: 'Southeast Asia', lat: 11.5466, lon: 104.8441, timezone: 'Asia/Phnom_Penh', rank: 52 },

  // ---------------- EAST ASIA ----------------
  { iata: 'HND', name: 'Haneda Airport', city: 'Tokyo', country: 'Japan', countryCode: 'JP', region: 'East Asia', lat: 35.5494, lon: 139.7798, timezone: 'Asia/Tokyo', rank: 97 },
  { iata: 'NRT', name: 'Narita International Airport', city: 'Tokyo', country: 'Japan', countryCode: 'JP', region: 'East Asia', lat: 35.7720, lon: 140.3929, timezone: 'Asia/Tokyo', rank: 90 },
  { iata: 'KIX', name: 'Kansai International Airport', city: 'Osaka', country: 'Japan', countryCode: 'JP', region: 'East Asia', lat: 34.4347, lon: 135.2441, timezone: 'Asia/Tokyo', rank: 82 },
  { iata: 'ICN', name: 'Incheon International Airport', city: 'Seoul', country: 'South Korea', countryCode: 'KR', region: 'East Asia', lat: 37.4602, lon: 126.4407, timezone: 'Asia/Seoul', rank: 94 },
  { iata: 'HKG', name: 'Hong Kong International Airport', city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK', region: 'East Asia', lat: 22.3080, lon: 113.9185, timezone: 'Asia/Hong_Kong', rank: 96 },
  { iata: 'PVG', name: 'Shanghai Pudong International Airport', city: 'Shanghai', country: 'China', countryCode: 'CN', region: 'East Asia', lat: 31.1443, lon: 121.8083, timezone: 'Asia/Shanghai', rank: 92 },
  { iata: 'PEK', name: 'Beijing Capital International Airport', city: 'Beijing', country: 'China', countryCode: 'CN', region: 'East Asia', lat: 40.0799, lon: 116.6031, timezone: 'Asia/Shanghai', rank: 93 },
  { iata: 'CAN', name: 'Guangzhou Baiyun International Airport', city: 'Guangzhou', country: 'China', countryCode: 'CN', region: 'East Asia', lat: 23.3924, lon: 113.2988, timezone: 'Asia/Shanghai', rank: 88 },
  { iata: 'TPE', name: 'Taiwan Taoyuan International Airport', city: 'Taipei', country: 'Taiwan', countryCode: 'TW', region: 'East Asia', lat: 25.0797, lon: 121.2342, timezone: 'Asia/Taipei', rank: 85 },

  // ---------------- MIDDLE EAST ----------------
  { iata: 'DXB', name: 'Dubai International Airport', city: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE', region: 'Middle East', lat: 25.2532, lon: 55.3657, timezone: 'Asia/Dubai', rank: 99 },
  { iata: 'AUH', name: 'Abu Dhabi International Airport', city: 'Abu Dhabi', country: 'United Arab Emirates', countryCode: 'AE', region: 'Middle East', lat: 24.4330, lon: 54.6511, timezone: 'Asia/Dubai', rank: 82 },
  { iata: 'DOH', name: 'Hamad International Airport', city: 'Doha', country: 'Qatar', countryCode: 'QA', region: 'Middle East', lat: 25.2731, lon: 51.6081, timezone: 'Asia/Qatar', rank: 92 },
  { iata: 'RUH', name: 'King Khalid International Airport', city: 'Riyadh', country: 'Saudi Arabia', countryCode: 'SA', region: 'Middle East', lat: 24.9576, lon: 46.6988, timezone: 'Asia/Riyadh', rank: 78 },
  { iata: 'JED', name: 'King Abdulaziz International Airport', city: 'Jeddah', country: 'Saudi Arabia', countryCode: 'SA', region: 'Middle East', lat: 21.6796, lon: 39.1565, timezone: 'Asia/Riyadh', rank: 76 },
  { iata: 'BAH', name: 'Bahrain International Airport', city: 'Manama', country: 'Bahrain', countryCode: 'BH', region: 'Middle East', lat: 26.2708, lon: 50.6336, timezone: 'Asia/Bahrain', rank: 65 },
  { iata: 'MCT', name: 'Muscat International Airport', city: 'Muscat', country: 'Oman', countryCode: 'OM', region: 'Middle East', lat: 23.5933, lon: 58.2844, timezone: 'Asia/Muscat', rank: 62 },
  { iata: 'TLV', name: 'Ben Gurion Airport', city: 'Tel Aviv', country: 'Israel', countryCode: 'IL', region: 'Middle East', lat: 32.0004, lon: 34.8706, timezone: 'Asia/Jerusalem', rank: 75 },
  { iata: 'IST', name: 'Istanbul Airport', city: 'Istanbul', country: 'Turkey', countryCode: 'TR', region: 'Middle East', lat: 41.2753, lon: 28.7519, timezone: 'Europe/Istanbul', rank: 93 },

  // ---------------- EUROPE ----------------
  { iata: 'LHR', name: 'Heathrow Airport', city: 'London', country: 'United Kingdom', countryCode: 'GB', region: 'Europe', lat: 51.4700, lon: -0.4543, timezone: 'Europe/London', rank: 98 },
  { iata: 'LGW', name: 'Gatwick Airport', city: 'London', country: 'United Kingdom', countryCode: 'GB', region: 'Europe', lat: 51.1537, lon: -0.1821, timezone: 'Europe/London', rank: 80 },
  { iata: 'MAN', name: 'Manchester Airport', city: 'Manchester', country: 'United Kingdom', countryCode: 'GB', region: 'Europe', lat: 53.3537, lon: -2.2750, timezone: 'Europe/London', rank: 72 },
  { iata: 'CDG', name: 'Charles de Gaulle Airport', city: 'Paris', country: 'France', countryCode: 'FR', region: 'Europe', lat: 49.0097, lon: 2.5479, timezone: 'Europe/Paris', rank: 96 },
  { iata: 'ORY', name: 'Orly Airport', city: 'Paris', country: 'France', countryCode: 'FR', region: 'Europe', lat: 48.7233, lon: 2.3794, timezone: 'Europe/Paris', rank: 75 },
  { iata: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', country: 'Germany', countryCode: 'DE', region: 'Europe', lat: 50.0379, lon: 8.5622, timezone: 'Europe/Berlin', rank: 95 },
  { iata: 'MUC', name: 'Munich Airport', city: 'Munich', country: 'Germany', countryCode: 'DE', region: 'Europe', lat: 48.3538, lon: 11.7861, timezone: 'Europe/Berlin', rank: 87 },
  { iata: 'BER', name: 'Berlin Brandenburg Airport', city: 'Berlin', country: 'Germany', countryCode: 'DE', region: 'Europe', lat: 52.3667, lon: 13.5033, timezone: 'Europe/Berlin', rank: 78 },
  { iata: 'AMS', name: 'Amsterdam Airport Schiphol', city: 'Amsterdam', country: 'Netherlands', countryCode: 'NL', region: 'Europe', lat: 52.3105, lon: 4.7683, timezone: 'Europe/Amsterdam', rank: 94 },
  { iata: 'MAD', name: 'Adolfo Suárez Madrid–Barajas Airport', city: 'Madrid', country: 'Spain', countryCode: 'ES', region: 'Europe', lat: 40.4983, lon: -3.5676, timezone: 'Europe/Madrid', rank: 89 },
  { iata: 'BCN', name: 'Josep Tarradellas Barcelona-El Prat Airport', city: 'Barcelona', country: 'Spain', countryCode: 'ES', region: 'Europe', lat: 41.2971, lon: 2.0785, timezone: 'Europe/Madrid', rank: 86 },
  { iata: 'FCO', name: 'Leonardo da Vinci–Fiumicino Airport', city: 'Rome', country: 'Italy', countryCode: 'IT', region: 'Europe', lat: 41.8003, lon: 12.2389, timezone: 'Europe/Rome', rank: 87 },
  { iata: 'MXP', name: 'Milan Malpensa Airport', city: 'Milan', country: 'Italy', countryCode: 'IT', region: 'Europe', lat: 45.6306, lon: 8.7281, timezone: 'Europe/Rome', rank: 80 },
  { iata: 'ZRH', name: 'Zurich Airport', city: 'Zurich', country: 'Switzerland', countryCode: 'CH', region: 'Europe', lat: 47.4647, lon: 8.5492, timezone: 'Europe/Zurich', rank: 84 },
  { iata: 'GVA', name: 'Geneva Airport', city: 'Geneva', country: 'Switzerland', countryCode: 'CH', region: 'Europe', lat: 46.2381, lon: 6.1090, timezone: 'Europe/Zurich', rank: 74 },
  { iata: 'VIE', name: 'Vienna International Airport', city: 'Vienna', country: 'Austria', countryCode: 'AT', region: 'Europe', lat: 48.1103, lon: 16.5697, timezone: 'Europe/Vienna', rank: 79 },
  { iata: 'BRU', name: 'Brussels Airport', city: 'Brussels', country: 'Belgium', countryCode: 'BE', region: 'Europe', lat: 50.9014, lon: 4.4844, timezone: 'Europe/Brussels', rank: 78 },
  { iata: 'CPH', name: 'Copenhagen Airport', city: 'Copenhagen', country: 'Denmark', countryCode: 'DK', region: 'Europe', lat: 55.6180, lon: 12.6560, timezone: 'Europe/Copenhagen', rank: 82 },
  { iata: 'ARN', name: 'Stockholm Arlanda Airport', city: 'Stockholm', country: 'Sweden', countryCode: 'SE', region: 'Europe', lat: 59.6519, lon: 17.9186, timezone: 'Europe/Stockholm', rank: 79 },
  { iata: 'OSL', name: 'Oslo Airport', city: 'Oslo', country: 'Norway', countryCode: 'NO', region: 'Europe', lat: 60.1976, lon: 11.1004, timezone: 'Europe/Oslo', rank: 76 },
  { iata: 'HEL', name: 'Helsinki-Vantaa Airport', city: 'Helsinki', country: 'Finland', countryCode: 'FI', region: 'Europe', lat: 60.3172, lon: 24.9633, timezone: 'Europe/Helsinki', rank: 77 },
  { iata: 'DUB', name: 'Dublin Airport', city: 'Dublin', country: 'Ireland', countryCode: 'IE', region: 'Europe', lat: 53.4213, lon: -6.2701, timezone: 'Europe/Dublin', rank: 78 },
  { iata: 'LIS', name: 'Humberto Delgado Airport', city: 'Lisbon', country: 'Portugal', countryCode: 'PT', region: 'Europe', lat: 38.7813, lon: -9.1359, timezone: 'Europe/Lisbon', rank: 77 },
  { iata: 'ATH', name: 'Athens International Airport', city: 'Athens', country: 'Greece', countryCode: 'GR', region: 'Europe', lat: 37.9364, lon: 23.9445, timezone: 'Europe/Athens', rank: 76 },
  { iata: 'WAW', name: 'Warsaw Chopin Airport', city: 'Warsaw', country: 'Poland', countryCode: 'PL', region: 'Europe', lat: 52.1657, lon: 20.9671, timezone: 'Europe/Warsaw', rank: 74 },
  { iata: 'PRG', name: 'Václav Havel Airport Prague', city: 'Prague', country: 'Czech Republic', countryCode: 'CZ', region: 'Europe', lat: 50.1008, lon: 14.2600, timezone: 'Europe/Prague', rank: 75 },
  { iata: 'BUD', name: 'Budapest Ferenc Liszt International Airport', city: 'Budapest', country: 'Hungary', countryCode: 'HU', region: 'Europe', lat: 47.4369, lon: 19.2556, timezone: 'Europe/Budapest', rank: 72 },
  { iata: 'SVO', name: 'Sheremetyevo International Airport', city: 'Moscow', country: 'Russia', countryCode: 'RU', region: 'Europe', lat: 55.9736, lon: 37.4125, timezone: 'Europe/Moscow', rank: 84 },

  // ---------------- NORTH AMERICA ----------------
  { iata: 'JFK', name: 'John F. Kennedy International Airport', city: 'New York', country: 'United States', countryCode: 'US', region: 'North America', lat: 40.6413, lon: -73.7781, timezone: 'America/New_York', rank: 97 },
  { iata: 'EWR', name: 'Newark Liberty International Airport', city: 'Newark', country: 'United States', countryCode: 'US', region: 'North America', lat: 40.6895, lon: -74.1745, timezone: 'America/New_York', rank: 85 },
  { iata: 'LAX', name: 'Los Angeles International Airport', city: 'Los Angeles', country: 'United States', countryCode: 'US', region: 'North America', lat: 33.9416, lon: -118.4085, timezone: 'America/Los_Angeles', rank: 95 },
  { iata: 'SFO', name: 'San Francisco International Airport', city: 'San Francisco', country: 'United States', countryCode: 'US', region: 'North America', lat: 37.6213, lon: -122.3790, timezone: 'America/Los_Angeles', rank: 90 },
  { iata: 'ORD', name: "O'Hare International Airport", city: 'Chicago', country: 'United States', countryCode: 'US', region: 'North America', lat: 41.9742, lon: -87.9073, timezone: 'America/Chicago', rank: 93 },
  { iata: 'ATL', name: 'Hartsfield–Jackson Atlanta International Airport', city: 'Atlanta', country: 'United States', countryCode: 'US', region: 'North America', lat: 33.6407, lon: -84.4277, timezone: 'America/New_York', rank: 96 },
  { iata: 'DFW', name: 'Dallas/Fort Worth International Airport', city: 'Dallas', country: 'United States', countryCode: 'US', region: 'North America', lat: 32.8998, lon: -97.0403, timezone: 'America/Chicago', rank: 91 },
  { iata: 'SEA', name: 'Seattle–Tacoma International Airport', city: 'Seattle', country: 'United States', countryCode: 'US', region: 'North America', lat: 47.4502, lon: -122.3088, timezone: 'America/Los_Angeles', rank: 85 },
  { iata: 'MIA', name: 'Miami International Airport', city: 'Miami', country: 'United States', countryCode: 'US', region: 'North America', lat: 25.7959, lon: -80.2870, timezone: 'America/New_York', rank: 87 },
  { iata: 'BOS', name: 'Logan International Airport', city: 'Boston', country: 'United States', countryCode: 'US', region: 'North America', lat: 42.3656, lon: -71.0096, timezone: 'America/New_York', rank: 84 },
  { iata: 'IAD', name: 'Washington Dulles International Airport', city: 'Washington D.C.', country: 'United States', countryCode: 'US', region: 'North America', lat: 38.9531, lon: -77.4565, timezone: 'America/New_York', rank: 82 },
  { iata: 'YYZ', name: 'Toronto Pearson International Airport', city: 'Toronto', country: 'Canada', countryCode: 'CA', region: 'North America', lat: 43.6777, lon: -79.6248, timezone: 'America/Toronto', rank: 88 },
  { iata: 'YVR', name: 'Vancouver International Airport', city: 'Vancouver', country: 'Canada', countryCode: 'CA', region: 'North America', lat: 49.1967, lon: -123.1815, timezone: 'America/Vancouver', rank: 82 },
  { iata: 'YUL', name: 'Montréal–Trudeau International Airport', city: 'Montreal', country: 'Canada', countryCode: 'CA', region: 'North America', lat: 45.4706, lon: -73.7408, timezone: 'America/Toronto', rank: 78 },
  { iata: 'MEX', name: 'Mexico City International Airport', city: 'Mexico City', country: 'Mexico', countryCode: 'MX', region: 'North America', lat: 19.4363, lon: -99.0721, timezone: 'America/Mexico_City', rank: 85 },
  { iata: 'CUN', name: 'Cancún International Airport', city: 'Cancún', country: 'Mexico', countryCode: 'MX', region: 'North America', lat: 21.0365, lon: -86.8771, timezone: 'America/Cancun', rank: 78 },

  // ---------------- OCEANIA ----------------
  { iata: 'SYD', name: 'Sydney Kingsford Smith Airport', city: 'Sydney', country: 'Australia', countryCode: 'AU', region: 'Oceania', lat: -33.9399, lon: 151.1753, timezone: 'Australia/Sydney', rank: 92 },
  { iata: 'MEL', name: 'Melbourne Airport', city: 'Melbourne', country: 'Australia', countryCode: 'AU', region: 'Oceania', lat: -37.6690, lon: 144.8410, timezone: 'Australia/Melbourne', rank: 88 },
  { iata: 'BNE', name: 'Brisbane Airport', city: 'Brisbane', country: 'Australia', countryCode: 'AU', region: 'Oceania', lat: -27.3942, lon: 153.1218, timezone: 'Australia/Brisbane', rank: 78 },
  { iata: 'PER', name: 'Perth Airport', city: 'Perth', country: 'Australia', countryCode: 'AU', region: 'Oceania', lat: -31.9403, lon: 115.9669, timezone: 'Australia/Perth', rank: 75 },
  { iata: 'AKL', name: 'Auckland Airport', city: 'Auckland', country: 'New Zealand', countryCode: 'NZ', region: 'Oceania', lat: -37.0082, lon: 174.7850, timezone: 'Pacific/Auckland', rank: 82 },
  { iata: 'NAN', name: 'Nadi International Airport', city: 'Nadi', country: 'Fiji', countryCode: 'FJ', region: 'Oceania', lat: -17.7554, lon: 177.4434, timezone: 'Pacific/Fiji', rank: 58 },

  // ---------------- AFRICA ----------------
  { iata: 'CAI', name: 'Cairo International Airport', city: 'Cairo', country: 'Egypt', countryCode: 'EG', region: 'Africa', lat: 30.1219, lon: 31.4056, timezone: 'Africa/Cairo', rank: 80 },
  { iata: 'JNB', name: 'O.R. Tambo International Airport', city: 'Johannesburg', country: 'South Africa', countryCode: 'ZA', region: 'Africa', lat: -26.1392, lon: 28.2460, timezone: 'Africa/Johannesburg', rank: 84 },
  { iata: 'CPT', name: 'Cape Town International Airport', city: 'Cape Town', country: 'South Africa', countryCode: 'ZA', region: 'Africa', lat: -33.9648, lon: 18.6017, timezone: 'Africa/Johannesburg', rank: 78 },
  { iata: 'NBO', name: 'Jomo Kenyatta International Airport', city: 'Nairobi', country: 'Kenya', countryCode: 'KE', region: 'Africa', lat: -1.3192, lon: 36.9278, timezone: 'Africa/Nairobi', rank: 75 },
  { iata: 'ADD', name: 'Bole International Airport', city: 'Addis Ababa', country: 'Ethiopia', countryCode: 'ET', region: 'Africa', lat: 8.9779, lon: 38.7993, timezone: 'Africa/Addis_Ababa', rank: 76 },
  { iata: 'LOS', name: 'Murtala Muhammed International Airport', city: 'Lagos', country: 'Nigeria', countryCode: 'NG', region: 'Africa', lat: 6.5774, lon: 3.3212, timezone: 'Africa/Lagos', rank: 74 },
  { iata: 'CMN', name: 'Mohammed V International Airport', city: 'Casablanca', country: 'Morocco', countryCode: 'MA', region: 'Africa', lat: 33.3675, lon: -7.5900, timezone: 'Africa/Casablanca', rank: 72 },
  { iata: 'MRU', name: 'Sir Seewoosagur Ramgoolam International Airport', city: 'Port Louis', country: 'Mauritius', countryCode: 'MU', region: 'Africa', lat: -20.4302, lon: 57.6836, timezone: 'Indian/Mauritius', rank: 62 },
  { iata: 'SEZ', name: 'Seychelles International Airport', city: 'Mahé', country: 'Seychelles', countryCode: 'SC', region: 'Africa', lat: -4.6743, lon: 55.5218, timezone: 'Indian/Mahe', rank: 55 },

  // ---------------- SOUTH AMERICA ----------------
  { iata: 'GRU', name: 'São Paulo/Guarulhos International Airport', city: 'São Paulo', country: 'Brazil', countryCode: 'BR', region: 'South America', lat: -23.4356, lon: -46.4731, timezone: 'America/Sao_Paulo', rank: 86 },
  { iata: 'GIG', name: 'Rio de Janeiro/Galeão International Airport', city: 'Rio de Janeiro', country: 'Brazil', countryCode: 'BR', region: 'South America', lat: -22.8100, lon: -43.2506, timezone: 'America/Sao_Paulo', rank: 78 },
  { iata: 'EZE', name: 'Ministro Pistarini International Airport', city: 'Buenos Aires', country: 'Argentina', countryCode: 'AR', region: 'South America', lat: -34.8222, lon: -58.5358, timezone: 'America/Argentina/Buenos_Aires', rank: 80 },
  { iata: 'SCL', name: 'Arturo Merino Benítez International Airport', city: 'Santiago', country: 'Chile', countryCode: 'CL', region: 'South America', lat: -33.3930, lon: -70.7858, timezone: 'America/Santiago', rank: 76 },
  { iata: 'LIM', name: 'Jorge Chávez International Airport', city: 'Lima', country: 'Peru', countryCode: 'PE', region: 'South America', lat: -12.0219, lon: -77.1143, timezone: 'America/Lima', rank: 75 },
  { iata: 'BOG', name: 'El Dorado International Airport', city: 'Bogotá', country: 'Colombia', countryCode: 'CO', region: 'South America', lat: 4.7016, lon: -74.1469, timezone: 'America/Bogota', rank: 76 },
];

/**
 * Placeholder for future full-dataset loading (e.g. OpenFlights CSV import).
 * Kept as a documented extension point per the architecture doc, not implemented
 * in this phase since it's a data ingestion task, not a service/API change.
 */
function loadFromCsv(_filePath) {
  throw new Error('loadFromCsv() is not implemented in this phase. See AIRPORTS array for the curated dataset currently in use.');
}

module.exports = { AIRPORTS, loadFromCsv };
