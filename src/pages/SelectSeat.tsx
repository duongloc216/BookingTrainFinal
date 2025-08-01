import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import { Navigation, Pagination } from 'swiper/modules';
import { 
  getTrainById, 
  generateTrainSeats, 
  type Train,
  getSeatsByCoach,
  isCompartmentEmpty,
  findNearestEmptyCompartment
} from '../mockData';

// CSS cho slider để đảm bảo tương tác
const sliderStyles = `
  /* Custom range slider styles */
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
    pointer-events: auto;
  }
  
  /* Track styles */
  input[type="range"]::-webkit-slider-track {
    background: transparent;
    height: 8px;
    border-radius: 4px;
    border: none;
  }
  
  input[type="range"]::-moz-range-track {
    background: transparent;
    height: 8px;
    border-radius: 4px;
    border: none;
  }
  
  /* Thumb styles - làm thumb trong suốt để dùng custom handle */
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    height: 28px;
    width: 28px;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    border: none;
    pointer-events: auto;
  }
  
  input[type="range"]::-moz-range-thumb {
    height: 28px;
    width: 28px;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    border: none;
    pointer-events: auto;
  }
  
  /* Focus styles */
  input[type="range"]:focus {
    outline: none;
  }
  
  input[type="range"]:focus::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px rgba(236, 64, 122, 0.2);
  }
  
  input[type="range"]:focus::-moz-range-thumb {
    box-shadow: 0 0 0 3px rgba(236, 64, 122, 0.2);
  }
  
  /* Đảm bảo mouse events hoạt động */
  .dual-range-container {
    position: relative;
    pointer-events: auto;
  }
  
  .dual-range-container input[type="range"] {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: auto;
    cursor: pointer;
  }
`;

// Local interface for this component (to maintain compatibility with existing logic)
interface LocalSeat {
  id: string;
  row: string;
  column: number;
  floor: 1 | 2 | 3;
  price: number;
  status: 'available' | 'occupied' | 'reserved' | 'selected';
  behavior: 'quiet' | 'social';
  nearWC: boolean;
  nearSimilarBehavior: boolean;
  passengersNearby: number;
}

// Danh sách mã tàu có file giá động
const DYNAMIC_PRICE_TRAINS = [
  'SE1', 'SE2', 'SE3', 'SE4', 'SE5', 'SE6', 'SE7', 'SE8', 'SE9', 'SE10', 'SE22'
];

// Hàm load file json giá động cho từng tàu
async function loadTrainPriceData(trainCode: string): Promise<any | null> {
  try {
    console.log(`Loading generated pricing data for train ${trainCode}...`);
    
    // Import generated pricing data instead of fetching from JSON
    try {
      const { ALL_GENERATED_PRICING_DATA } = await import('../mockData/generated');
      console.log(`Imported pricing data for ${ALL_GENERATED_PRICING_DATA.length} trains`);
      console.log('Available train IDs:', ALL_GENERATED_PRICING_DATA.map(t => t.trainId));
      
      const trainPricing = ALL_GENERATED_PRICING_DATA.find(t => t.trainId === trainCode);
      
      if (!trainPricing) {
        console.error(`No generated pricing data found for train ${trainCode}`);
        console.log('Available trains:', ALL_GENERATED_PRICING_DATA.map(t => t.trainId));
        return null;
      }
      
      console.log(`Found pricing data for ${trainCode} with ${trainPricing.routes.length} routes`);
      
      // Convert to format expected by parseDynamicPrices
      const train_fares = trainPricing.routes.map(route => ({
        origin: route.origin,
        destination: route.destination,
        flat_seats: [
          // Convert seating cars - format: SE1-ngoi-1-1, SE1-ngoi-1-2, etc.
          ...route.fares.seating?.flatMap(car => 
            car.rows.flatMap(row => 
              row.row_numbers.map(seatNum => ({
                id: `${trainCode}-ngoi-${car.car_number}-${seatNum}`,
                car: car.car_number,
                row: Math.ceil(seatNum / 2), // Convert seat number back to row
                price: row.price
              }))
            )
          ) || [],
          // Convert 6-berth sleeper cars - format: SE1-k6-3-1, SE1-k6-3-2, etc.
          ...route.fares.sleeper_6_berth?.flatMap(car => 
            car.rows.flatMap(row => 
              row.row_numbers.map(seatNum => ({
                id: `${trainCode}-k6-${car.car_number}-${seatNum}`,
                car: car.car_number,
                row: Math.ceil(seatNum / 6), // 6 seats per compartment
                price: row.price
              }))
            )
          ) || [],
          // Convert 4-berth sleeper cars - format: SE1-k4-10-1, SE1-k4-10-2, etc.
          ...route.fares.sleeper_4_berth?.flatMap(car => 
            car.rows.flatMap(row => 
              row.row_numbers.map(seatNum => ({
                id: `${trainCode}-k4-${car.car_number}-${seatNum}`,
                car: car.car_number,
                row: Math.ceil(seatNum / 4), // 4 seats per compartment
                price: row.price
              }))
            )
          ) || []
        ]
      }));
      
      console.log(`Converted to train_fares format with ${train_fares.length} routes`);
      train_fares.forEach(fare => {
        console.log(`  Route ${fare.origin} -> ${fare.destination}: ${fare.flat_seats.length} seats`);
      });
      
      return { train_fares };
      
    } catch (importError) {
      console.error('Error importing generated pricing data:', importError);
      return null;
    }
    
  } catch (e) {
    console.error(`Error loading generated pricing data for ${trainCode}:`, e);
    return null;
  }
}

// Hàm lấy giá cho từng ghế từ file json
interface DynamicPriceItem {
  id: string;
  type: string;
  car: number | null;
  row: number;
  price: number;
}

function parseDynamicPrices(
  trainCode: string,
  priceData: any,
  from: string,
  to: string
): DynamicPriceItem[] {
  const result: DynamicPriceItem[] = [];
  if (!priceData || !priceData.train_fares) return result;
  
  // Chuẩn hóa tên ga
  const norm = (s: string) => {
    let normalized = s
      .trim()
      .toUpperCase()
      .replace(/^GA\s+/, '') // Loại bỏ "GA " ở đầu
      .replace(/\s+/g, ' ') // Chuẩn hóa khoảng trắng
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // Loại bỏ dấu
    
    // Mapping tên ga đặc biệt
    if (normalized === 'SAI GON') {
      normalized = 'HO CHI MINH';
    }
    
    return normalized;
  };
  from = norm(from);
  to = norm(to);
  
  console.log(`Looking for route: "${from}" → "${to}" in ${trainCode}`);
  console.log('Available routes in data:', priceData.train_fares.map((f: any) => `"${norm(f.origin)}" → "${norm(f.destination)}"`));
  
  // Tìm hành trình phù hợp
  const fare = priceData.train_fares.find((f: any) => norm(f.origin) === from && norm(f.destination) === to);
  if (!fare) {
    console.log(`Không tìm thấy hành trình ${from} → ${to} trong ${trainCode}.json`);
    return result;
  }
  
  // Chỉ lấy dữ liệu từ flat_seats
  if (fare.flat_seats && Array.isArray(fare.flat_seats)) {
    return fare.flat_seats.map((item: any) => ({
      id: item.id,
      type: '',
      car: item.car,
      row: item.row,
      price: item.price
    }));
  }
  // Nếu không có flat_seats thì trả về rỗng
  return result;
}

// Hàm format giá thành dạng K
const formatPrice = (price: number) => {
  return `${Math.round(price / 1000)}K`;
};

// Cấu trúc toa chuẩn cho mọi tàu
const COACHES = [
  { id: 1, type: 'Soft seat', seats: 28, price: 990000 },
  { id: 2, type: 'Soft seat', seats: 28, price: 990000 },
  { id: 3, type: '6-berth cabin', seats: 42, price: 1200000 },
  { id: 4, type: '6-berth cabin', seats: 42, price: 1200000 },
  { id: 5, type: '6-berth cabin', seats: 42, price: 1200000 },
  { id: 6, type: '4-berth cabin', seats: 28, price: 1500000 },
  { id: 7, type: '4-berth cabin', seats: 28, price: 1500000 },
  { id: 8, type: '4-berth cabin', seats: 28, price: 1500000 },
  { id: 9, type: '4-berth cabin', seats: 28, price: 1500000 },
  { id: 10, type: '4-berth cabin', seats: 28, price: 1500000 },
];

// SVG ghế vuông
const SeatIcon = ({ size = 32, color = "#e0e0e0" }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <rect x="4" y="8" width="24" height="16" rx="4" fill={color} />
    <rect x="8" y="24" width="4" height="6" rx="2" fill={color} />
    <rect x="20" y="24" width="4" height="6" rx="2" fill={color} />
  </svg>
);
const SeatIconOccupied = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <rect x="4" y="8" width="24" height="16" rx="4" fill="#ededed" />
    <rect x="8" y="24" width="4" height="6" rx="2" fill="#ededed" />
    <rect x="20" y="24" width="4" height="6" rx="2" fill="#ededed" />
    <line x1="8" y1="12" x2="24" y2="24" stroke="#bbb" strokeWidth="2"/>
    <line x1="24" y1="12" x2="8" y2="24" stroke="#bbb" strokeWidth="2"/>
  </svg>
);

// Bảng noise và màu tương ứng cho toa 1 (Ngồi mềm)
// const NOISE_COLORS = [ ... ];
// const NOISE_MATRIX = [ ... ];
// function getNoiseColor(value: number) { ... }

// Bảng noise cho từng khoang/tầng của toa 2 (Gối mềm)
// const NOISE_MATRIX_2 = [ ... ];
// function getNoiseColor2(value: number) { ... }

// Bảng noise cho từng khoang/tầng của toa 3 (Nằm khoang 6)
const NOISE_KHOANGS_1 = [
  // Hàng 1
  [1200, 1205, 1210, 1215, 1220, 1225, 1230],
  // Hàng 2
  [1235, 1240, 1245, 1250, 1255, 1260, 1265],
  // Hàng 3
  [1270, 1275, 1280, 1285, 1290, 1295, 1300],
  // Hàng 4
  [1305, 1310, 1315, 1320, 1325, 1330, 1335],
];

// Bảng noise cho từng khoang/tầng của toa 4 (Nằm khoang 6)
const NOISE_KHOANGS_2 = [
  // Hàng 1
  [1340, 1345, 1350, 1355, 1360, 1365, 1370],
  // Hàng 2
  [1375, 1380, 1385, 1390, 1395, 1400, 1405],
  // Hàng 3
  [1410, 1415, 1420, 1425, 1430, 1435, 1440],
  // Hàng 4
  [1445, 1450, 1455, 1460, 1465, 1470, 1475],
];
// Màu sắc: gradient cam-xanh lá


// Bảng noise cho từng khoang/tầng của toa 5 (Nằm khoang 6)
const NOISE_KHOANGS_3 = [
  // Khoang 1
  [642, 635, 628, 647, 640, 633],
  // Khoang 2
  [652, 645, 638, 657, 650, 643],
  // Khoang 3
  [662, 655, 648, 667, 660, 653],
  // Khoang 4
  [672, 665, 658, 677, 670, 663],
  // Khoang 5
  [682, 675, 668, 687, 680, 673],
  // Khoang 6
  [692, 685, 678, 697, 690, 683],
  // Khoang 7
  [702, 700, 693, 707, 700, 693],
];
// Màu sắc: cam đậm đến cam nhạt (tự động tính theo giá trị, hoặc bạn có thể bổ sung mã màu cụ thể nếu muốn)
function getNoiseColor3_v2(value: number) {
  // Gradient từ #f97316 (cam đậm) đến #fde68a (cam nhạt)
  // Giá trị nhỏ nhất: 628, lớn nhất: 707
  const min = 628, max = 707;
  const percent = (value - min) / (max - min);
  // Interpolate màu cam đậm (#f97316) đến cam nhạt (#fde68a)
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 253, g: 230, b: 138 };
  const r = Math.round(lerp(c1.r, c2.r, percent));
  const g = Math.round(lerp(c1.g, c2.g, percent));
  const b = Math.round(lerp(c1.b, c2.b, percent));
  return `rgb(${r},${g},${b})`;
}

// Bảng noise cho từng khoang/tầng của toa 6 (Nằm khoang 4)
const NOISE_KHOANGS_4 = [
  // Khoang 1
  [712, 705, 698, 717, 710, 703],
  // Khoang 2
  [722, 715, 708, 727, 720, 713],
  // Khoang 3
  [732, 725, 718, 737, 730, 723],
  // Khoang 4
  [742, 735, 728, 747, 740, 733],
  // Khoang 5
  [752, 745, 738, 757, 750, 743],
  // Khoang 6
  [762, 755, 748, 767, 760, 753],
  // Khoang 7
  [772, 765, 758, 777, 770, 763],
];
// Màu sắc: gradient vàng-xanh lá
function getNoiseColor4_v2(value: number) {
  // Gradient từ #fde68a (vàng nhạt) đến #22c55e (xanh lá)
  // Giá trị nhỏ nhất: 698, lớn nhất: 777
  const min = 698, max = 777;
  const percent = (value - min) / (max - min);
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  const c1 = { r: 253, g: 230, b: 138 }, c2 = { r: 34, g: 197, b: 94 };
  const r = Math.round(lerp(c1.r, c2.r, percent));
  const g = Math.round(lerp(c1.g, c2.g, percent));
  const b = Math.round(lerp(c1.b, c2.b, percent));
  return `rgb(${r},${g},${b})`;
}

// Bảng noise cho từng khoang/tầng của toa 7 (Nằm khoang 4)
const NOISE_KHOANGS_5 = [
  // Khoang 1
  [782, 775, 768, 787, 780, 773],
  // Khoang 2
  [792, 785, 778, 797, 790, 783],
  // Khoang 3
  [802, 795, 788, 807, 800, 793],
  // Khoang 4
  [812, 805, 798, 817, 810, 803],
  // Khoang 5
  [822, 815, 808, 827, 820, 813],
  // Khoang 6
  [832, 825, 818, 837, 830, 823],
  // Khoang 7
  [842, 835, 828, 847, 840, 833],
];
// Màu sắc: gradient xanh lá nhạt đến xanh lá đậm
function getNoiseColor5_v2(value: number) {
  // Gradient từ #bbf7d0 (xanh lá nhạt) đến #22c55e (xanh lá đậm)
  // Giá trị nhỏ nhất: 768, lớn nhất: 847
  const min = 768, max = 847;
  const percent = (value - min) / (max - min);
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  const c1 = { r: 187, g: 247, b: 208 }, c2 = { r: 34, g: 197, b: 94 };
  const r = Math.round(lerp(c1.r, c2.r, percent));
  const g = Math.round(lerp(c1.g, c2.g, percent));
  const b = Math.round(lerp(c1.b, c2.b, percent));
  return `rgb(${r},${g},${b})`;
}

// Bảng noise cho từng khoang/tầng của toa 8 (Nằm khoang 4)
const NOISE_KHOANGS_4_5 = [
  // Khoang 1
  [1487, 1476, 1487, 1476],
  // Khoang 2
  [1490, 1476, 1490, 1476],
  // Khoang 3
  [1494, 1477, 1494, 1477],
  // Khoang 4
  [1498, 1478, 1502, 1480],
  // Khoang 5
  [1502, 1480, 1507, 1482],
  // Khoang 6
  [1507, 1482, 1511, 1484],
  // Khoang 7
  [1511, 1484, 1511, 1484],
];
// Màu sắc: cam đậm đến cam nhạt (giống Nằm khoang 6)
function getNoiseColor4_5_v2(value: number) {
  // Gradient từ #f97316 (cam đậm) đến #fde68a (cam nhạt)
  // Giá trị nhỏ nhất: 1476, lớn nhất: 1511
  const min = 1476, max = 1511;
  const percent = (value - min) / (max - min);
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 253, g: 230, b: 138 };
  const r = Math.round(lerp(c1.r, c2.r, percent));
  const g = Math.round(lerp(c1.g, c2.g, percent));
  const b = Math.round(lerp(c1.b, c2.b, percent));
  return `rgb(${r},${g},${b})`;
}



// Bảng noise cho từng khoang/tầng của toa 6 (Nằm khoang 4)
const NOISE_KHOANGS_4_6 = [
  // Khoang 1
  [1520, 1484, 1524, 1485],
  // Khoang 2
  [1524, 1486, 1528, 1487],
  // Khoang 3
  [1528, 1488, 1532, 1489],
  // Khoang 4
  [1532, 1490, 1536, 1491],
  // Khoang 5
  [1536, 1492, 1540, 1493],
  // Khoang 6
  [1540, 1494, 1544, 1495],
  // Khoang 7
  [1544, 1496, 1548, 1497],
];
// Màu sắc: gradient cam-xanh lá
function getNoiseColor4_6_v2(value: number) {
  // Gradient từ #f97316 (cam đậm) đến #22c55e (xanh lá)
  // Giá trị nhỏ nhất: 1484, lớn nhất: 1548
  const min = 1484, max = 1548;
  const percent = (value - min) / (max - min);
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 34, g: 197, b: 94 };
  const r = Math.round(lerp(c1.r, c2.r, percent));
  const g = Math.round(lerp(c1.g, c2.g, percent));
  const b = Math.round(lerp(c1.b, c2.b, percent));
  return `rgb(${r},${g},${b})`;
}

// Bảng noise cho từng khoang/tầng của toa 7 (Nằm khoang 4)
const NOISE_KHOANGS_4_7 = [
  // Khoang 1
  [1552, 1498, 1556, 1499],
  // Khoang 2
  [1556, 1500, 1560, 1501],
  // Khoang 3
  [1560, 1502, 1564, 1503],
  // Khoang 4
  [1564, 1504, 1568, 1505],
  // Khoang 5
  [1568, 1506, 1572, 1507],
  // Khoang 6
  [1572, 1508, 1576, 1509],
  // Khoang 7
  [1576, 1510, 1580, 1511],
];
// Màu sắc: gradient cam-xanh lá
function getNoiseColor4_7_v2(value: number) {
  // Gradient từ #f97316 (cam đậm) đến #22c55e (xanh lá)
  // Giá trị nhỏ nhất: 1498, lớn nhất: 1580
  const min = 1498, max = 1580;
  const percent = (value - min) / (max - min);
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 34, g: 197, b: 94 };
  const r = Math.round(lerp(c1.r, c2.r, percent));
  const g = Math.round(lerp(c1.g, c2.g, percent));
  const b = Math.round(lerp(c1.b, c2.b, percent));
  return `rgb(${r},${g},${b})`;
}

// Bảng noise cho từng khoang/tầng của toa 8 (Nằm khoang 4)
const NOISE_KHOANGS_4_8 = [
  // Khoang 1
  [1584, 1512, 1588, 1513],
  // Khoang 2
  [1588, 1514, 1592, 1515],
  // Khoang 3
  [1592, 1516, 1596, 1517],
  // Khoang 4
  [1596, 1518, 1600, 1519],
  // Khoang 5
  [1600, 1520, 1604, 1521],
  // Khoang 6
  [1604, 1522, 1608, 1523],
  // Khoang 7
  [1608, 1524, 1612, 1525],
];
// Màu sắc: gradient cam-xanh lá
function getNoiseColor4_8_v2(value: number) {
  // Gradient từ #f97316 (cam đậm) đến #22c55e (xanh lá)
  // Giá trị nhỏ nhất: 1512, lớn nhất: 1612
  const min = 1512, max = 1612;
  const percent = (value - min) / (max - min);
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 34, g: 197, b: 94 };
  const r = Math.round(lerp(c1.r, c2.r, percent));
  const g = Math.round(lerp(c1.g, c2.g, percent));
  const b = Math.round(lerp(c1.b, c2.b, percent));
  return `rgb(${r},${g},${b})`;
}

// Bảng noise cho từng khoang/tầng của toa 9 (Nằm khoang 4)
const NOISE_KHOANGS_4_9 = [
  // Khoang 1
  [1616, 1526, 1620, 1527],
  // Khoang 2
  [1620, 1528, 1624, 1529],
  // Khoang 3
  [1624, 1530, 1628, 1531],
  // Khoang 4
  [1628, 1532, 1632, 1533],
  // Khoang 5
  [1632, 1534, 1636, 1535],
  // Khoang 6
  [1636, 1536, 1640, 1537],
  // Khoang 7
  [1640, 1538, 1644, 1539],
];
// Màu sắc: gradient cam-xanh lá
function getNoiseColor4_9_v2(value: number) {
  // Gradient từ #f97316 (cam đậm) đến #22c55e (xanh lá)
  // Giá trị nhỏ nhất: 1526, lớn nhất: 1644
  const min = 1526, max = 1644;
  const percent = (value - min) / (max - min);
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 34, g: 197, b: 94 };
  const r = Math.round(lerp(c1.r, c2.r, percent));
  const g = Math.round(lerp(c1.g, c2.g, percent));
  const b = Math.round(lerp(c1.b, c2.b, percent));
  return `rgb(${r},${g},${b})`;
}

// Bảng noise cho từng khoang/tầng của toa 10 (Nằm khoang 4)
const NOISE_KHOANGS_4_10 = [
  // Khoang 1
  [1648, 1540, 1652, 1541],
  // Khoang 2
  [1652, 1542, 1656, 1543],
  // Khoang 3
  [1656, 1544, 1660, 1545],
  // Khoang 4
  [1660, 1546, 1664, 1547],
  // Khoang 5
  [1664, 1548, 1668, 1549],
  // Khoang 6
  [1668, 1550, 1672, 1551],
  // Khoang 7
  [1672, 1552, 1676, 1553],
];
// Màu sắc: gradient cam-xanh lá
function getNoiseColor4_10_v2(value: number) {
  // Gradient từ #f97316 (cam đậm) đến #22c55e (xanh lá)
  // Giá trị nhỏ nhất: 1540, lớn nhất: 1676
  const min = 1540, max = 1676;
  const percent = (value - min) / (max - min);
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 34, g: 197, b: 94 };
  const r = Math.round(lerp(c1.r, c2.r, percent));
  const g = Math.round(lerp(c1.g, c2.g, percent));
  const b = Math.round(lerp(c1.b, c2.b, percent));
  return `rgb(${r},${g},${b})`;
}

// Hàm flatten đúng thứ tự UI cho các toa 6-10 (3 tầng, 2 giường mỗi khoang, 7 khoang, 5 toa)
function flattenNoiseMatrixForCoaches6to10_strictOrder() {
  const matrices = [NOISE_KHOANGS_4_6, NOISE_KHOANGS_4_7, NOISE_KHOANGS_4_8, NOISE_KHOANGS_4_9, NOISE_KHOANGS_4_10];
  const result: number[] = [];
  // Toa (6→10)
  for (let m = 0; m < matrices.length; m++) {
    const matrix = matrices[m];
    // Khoang (1→7)
    for (let khoang = 0; khoang < matrix.length; khoang++) {
      // Tầng (2→1)
      for (let tang = 1; tang >= 0; tang--) {
        // Lấy trung bình 2 giường của tầng này
        const v1 = matrix[khoang][tang*2];
        const v2 = matrix[khoang][tang*2+1];
        const avg = (v1 + v2) / 2;
        result.push(avg);
      }
    }
  }
  return result;
}

const SelectSeat: React.FC = () => {
  console.log('🚀 SelectSeat component loaded!');
  console.log('📅 Current time:', new Date().toLocaleTimeString());
  
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Lấy dữ liệu từ URL params
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const departDate = searchParams.get('departDate') || '';
  const trainId = searchParams.get('trainId') || '';
  
  // Lấy dữ liệu hành khách từ params
  const passengerData = searchParams.get('passengers');
  const passenger = passengerData ? JSON.parse(decodeURIComponent(passengerData)) : {
    adult: 0,
    child: 0,
    elderly: 0,
    student: 0,
    union: 0,
  };
  const totalPassengers = passenger.adult + passenger.child + passenger.elderly + passenger.student + passenger.union;
  
  // State cho giá động
  const [dynamicPrices, setDynamicPrices] = useState<DynamicPriceItem[]>([]);
  // const [loadingPrices, setLoadingPrices] = useState(false);
  
  // State cho ghế và bộ lọc
  const [seats, setSeats] = useState<LocalSeat[]>([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [selectedCoachIdx, setSelectedCoachIdx] = useState(0);
  const [autoSelectMessage, setAutoSelectMessage] = useState<string>('');

  // Tạo mô tả hành khách
  const getPassengerDescription = () => {
    const parts = [];
    if (passenger.adult > 0) parts.push(`${passenger.adult} người lớn`);
    if (passenger.child > 0) parts.push(`${passenger.child} trẻ em`);
    if (passenger.elderly > 0) parts.push(`${passenger.elderly} người già`);
    if (passenger.student > 0) parts.push(`${passenger.student} học sinh`);
    if (passenger.union > 0) parts.push(`${passenger.union} đoàn viên`);
    return parts.join(', ');
  };

  // Function để render toàn bộ layout ghế của một toa
  const renderCoachSeats = (coach: any) => {
    const coachSeatsData = coachSeats[coach.id] || [];
    
    // Logic render khác nhau cho từng loại toa
    if (coach.type === 'Soft seat' && coach.id === 1) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, justifyItems: 'center', minHeight: 320, background: '#fff' }}>
          {[0, 1, 2].map(idx => <div key={'empty-row-' + idx} />)}
          <div key="empty-row-wc" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 12, color: '#1976d2', fontWeight: 600, background: '#e3f2fd', borderRadius: 8, padding: '2px 8px' }}>Toilet</span>
          </div>
          {coachSeatsData.map((seat, idx) => {
            if (!seat) return <div key={idx} />;
            const seatColor = getSeatColor(coach.id, idx);
            return <SeatButton key={seat.id} seat={seat} seatColor={seatColor} />;
          })}
        </div>
      );
    }
    
    // Toa ghế mềm (Toa 2) 
    if (coach.type === 'Soft seat' && coach.id === 2) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, justifyItems: 'center', minHeight: 320, background: '#fff' }}>
          {[0, 1, 2].map(idx => <div key={'empty-row-' + idx} />)}
          <div key="empty-row-wc" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 12, color: '#1976d2', fontWeight: 600, background: '#e3f2fd', borderRadius: 8, padding: '2px 8px' }}>Toilet</span>
          </div>
          {coachSeatsData.map((seat, idx) => {
            if (!seat) return <div key={idx} />;
            const seatColor = getSeatColor(coach.id, idx);
            return <SeatButton key={seat.id} seat={seat} seatColor={seatColor} />;
          })}
        </div>
      );
    }
    
    // Toa ghế mềm khác (code cũ để backup)
    if (coach.type === 'Gối mềm' && coach.id === 2) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, justifyItems: 'center', minHeight: 320, background: '#fff' }}>
          {[0, 1, 2].map(idx => <div key={'empty-row-' + idx} />)}
          <div key="empty-row-wc" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 12, color: '#1976d2', fontWeight: 600, background: '#e3f2fd', borderRadius: 8, padding: '2px 8px' }}>Toilet</span>
          </div>
          {coachSeatsData.map((seat, idx) => {
            if (!seat) return <div key={idx} />;
            const seatColor = getSeatColor(coach.id, idx);
            return <SeatButton key={seat.id} seat={seat} seatColor={seatColor} />;
          })}
        </div>
      );
    }
    
    // Toa nằm khoang 6 (Toa 3,4,5)
    if (coach.type === '6-berth cabin') {
      return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 12, color: '#1976d2', fontWeight: 600, background: '#e3f2fd', borderRadius: 8, padding: '2px 8px' }}>Toilet</span>
          </div>
          {Array.from({ length: 7 }, (_, khoangIdx) => (
            <div key={khoangIdx} style={{ marginBottom: 20, background: '#f7f7fa', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Compartment {khoangIdx + 1}</div>
              {[2,1,0].map(tangIdx => (
                <div key={tangIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                  {[0,1].map(seatInTang => {
                    const seatIdx = tangIdx*2 + seatInTang;
                    const seat = coachSeatsData[khoangIdx*6 + seatIdx];
                    if (!seat) return <div key={seatIdx} style={{ width: 40 }} />;
                    const seatColor = getSeatColor(coach.id, khoangIdx * 6 + seatIdx);
                    return <SeatButton key={seat.id} seat={seat} seatColor={seatColor} />;
                  })}
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#888' }}>Level {tangIdx + 1}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }
    
    // Toa nằm khoang 4 (Toa 6,7,8,9,10)
    if (coach.type === '4-berth cabin') {
      return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 12, color: '#1976d2', fontWeight: 600, background: '#e3f2fd', borderRadius: 8, padding: '2px 8px' }}>Toilet</span>
          </div>
          {Array.from({ length: 7 }, (_, khoangIdx) => (
            <div key={khoangIdx} style={{ marginBottom: 20, background: '#f7f7fa', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Compartment {khoangIdx + 1}</div>
              {[1,0].map(tangIdx => (
                <div key={tangIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                  {[0,1].map(seatInTang => {
                    const seatIdx = tangIdx*2 + seatInTang;
                    const seat = coachSeatsData[khoangIdx*4 + seatIdx];
                    if (!seat) return <div key={seatIdx} style={{ width: 40 }} />;
                    const seatColor = getSeatColor(coach.id, khoangIdx * 4 + seatIdx);
                    return <SeatButton key={seat.id} seat={seat} seatColor={seatColor} />;
                  })}
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#888' }}>Level {tangIdx + 1}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }
    
    // Fallback cho loại toa khác
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, justifyItems: 'center', minHeight: 320, background: '#fff' }}>
        {coachSeatsData.map((seat, idx) => {
          if (!seat) return <div key={idx} />;
          const seatColor = getSeatColor(coach.id, idx);
          return <SeatButton key={seat.id} seat={seat} seatColor={seatColor} />;
        })}
      </div>
    );
  };

  // Component render ghế đơn giản hóa tất cả logic với filter highlight
  const SeatButton = ({ seat, seatColor, size = 32 }: { seat: LocalSeat; seatColor: string; size?: number }) => {
    const isOccupied = seat.status === 'occupied';
    const isSelected = selectedSeatIds.includes(seat.id);
    const isFiltered = isFilterActive && filteredSeatIds.includes(seat.id);
    const isFilteredOut = isFilterActive && !filteredSeatIds.includes(seat.id) && seat.status === 'available';
    
    // Debug logging for seat visibility
    if (isFilterActive) {
      console.log(`🪑 Seat ${seat.id}:`, {
        isOccupied,
        isSelected,
        isFiltered,
        isFilteredOut,
        inFilteredList: filteredSeatIds.includes(seat.id),
        status: seat.status
      });
    }
    
    return (
      <button
        key={seat.id}
        onClick={() => handleSeatSelect(seat.id)}
        disabled={isOccupied}
        style={{
          background: isSelected ? '#e3f2fd' : isFiltered ? '#fff8e1' : '#fff',
          border: isSelected ? '3px solid #1976d2' : isFiltered ? '3px solid #ff9800' : '2px solid #e0e0e0',
          borderRadius: 8,
          padding: 0,
          cursor: isOccupied ? 'not-allowed' : 'pointer',
          // Improved opacity logic - don't make filtered out seats too dim
          opacity: isOccupied ? 0.4 : isFilteredOut ? 0.6 : 1, // Changed from 0.3 to 0.6
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
          minWidth: 40,
          boxShadow: isSelected ? '0 2px 8px rgba(25, 118, 210, 0.3)' : isFiltered ? '0 2px 8px rgba(255, 152, 0, 0.3)' : 'none',
          transform: isSelected ? 'scale(1.05)' : isFiltered ? 'scale(1.02)' : 'scale(1)',
          transition: 'all 0.2s ease',
          // Add visual indicator for filter state
          outline: isFilteredOut ? '1px dashed #ccc' : 'none'
        }}
      >
        {isSelected && (
          <div style={{
            position: 'absolute',
            top: -8,
            right: -8,
            background: '#4caf50',
            color: '#fff',
            borderRadius: '50%',
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            zIndex: 10
          }}>
            ✓
          </div>
        )}
        {isFiltered && !isSelected && (
          <div style={{
            position: 'absolute',
            top: -8,
            right: -8,
            background: '#ff9800',
            color: '#fff',
            borderRadius: '50%',
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            zIndex: 10
          }}>
            ★
          </div>
        )}
        {isOccupied ? <SeatIconOccupied size={size} /> : <SeatIcon size={size} color={seatColor} />}
        <span style={{ fontWeight: 700, fontSize: 13, color: isSelected ? '#1976d2' : isFiltered ? '#ff9800' : '#222', marginTop: 2 }}>{seat.column}</span>
        <span style={{ fontSize: 11, color: '#888' }}>{formatPrice(seat.price)}</span>
      </button>
    );
  };

  // Hàm render ghế với highlight khi được chọn
  const renderSeatButton = (seat: LocalSeat, seatColor: string, size = 32) => {
    const isOccupied = seat.status === 'occupied';
    const isSelected = selectedSeatIds.includes(seat.id);
    
    console.log(`Rendering seat ${seat.id}, isSelected: ${isSelected}, selectedSeatIds:`, selectedSeatIds);
    
    return (
      <button
        key={seat.id}
        onClick={() => handleSeatSelect(seat.id)}
        disabled={isOccupied}
        style={{
          background: isSelected ? '#e3f2fd' : '#fff',
          border: isSelected ? '3px solid #1976d2' : '2px solid #e0e0e0',
          borderRadius: 8,
          padding: 0,
          cursor: isOccupied ? 'not-allowed' : 'pointer',
          opacity: isOccupied ? 0.4 : 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
          minWidth: 40,
          boxShadow: isSelected ? '0 2px 8px rgba(25, 118, 210, 0.3)' : 'none',
          transform: isSelected ? 'scale(1.05)' : 'scale(1)',
          transition: 'all 0.2s ease'
        }}
      >
        {isSelected && (
          <div style={{
            position: 'absolute',
            top: -8,
            right: -8,
            background: '#4caf50',
            color: '#fff',
            borderRadius: '50%',
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            zIndex: 10
          }}>
            ✓
          </div>
        )}
        {isOccupied ? <SeatIconOccupied size={size} /> : <SeatIcon size={size} color={seatColor} />}
        <span style={{ fontWeight: 700, fontSize: 13, color: isSelected ? '#1976d2' : '#222', marginTop: 2 }}>{seat.column}</span>
        <span style={{ fontSize: 11, color: '#888' }}>{formatPrice(seat.price)}</span>
      </button>
    );
  };

  // Load giá động từ file JSON
  useEffect(() => {
    async function loadDynamicPrices() {
      if (!DYNAMIC_PRICE_TRAINS.includes(trainId)) {
        console.log(`Tàu ${trainId} không có file giá động, sử dụng mock data`);
        return;
      }
      
      console.log(`Starting loadDynamicPrices for ${trainId}: ${from} → ${to}`);
      
      // const setLoadingPrices = true;
      try {
        const priceData = await loadTrainPriceData(trainId);
        console.log(`loadTrainPriceData returned:`, priceData ? 'success' : 'null');
        
        if (priceData) {
          const prices = parseDynamicPrices(trainId, priceData, from, to);
          setDynamicPrices(prices);
          console.log(`Loaded ${prices.length} dynamic prices for ${trainId}:`, prices);
          
          // Debug: log một số ví dụ seatId để kiểm tra
          if (prices.length > 0) {
            console.log('Sample dynamic prices:');
            prices.slice(0, 10).forEach(price => {
              console.log(`  ${price.id}: ${price.price}`);
            });
            
            // Debug: log số lượng giá cho từng loại
            const seatingCount = prices.filter(p => p.id.includes('-ngoi-')).length;
            const k6Count = prices.filter(p => p.id.includes('-k6-')).length;
            const k4Count = prices.filter(p => p.id.includes('-k4-')).length;
            console.log(`Dynamic prices breakdown: seating=${seatingCount}, k6=${k6Count}, k4=${k4Count}`);
          }
        } else {
          console.log(`Không load được file ${trainId}.json`);
        }
      } catch (error) {
        console.error('Error loading dynamic prices:', error);
      } finally {
        // setLoadingPrices(false);
      }
    }
    
    loadDynamicPrices();
  }, [trainId, from, to]);
  
  console.log('SelectSeat component loaded with dynamic prices:', { trainId, from, to, dynamicPrices });

// Sinh dữ liệu ghế cho từng toa dựa trên COACHES và giá động
const [coachSeats, setCoachSeats] = useState<Record<number, LocalSeat[]>>({});
useEffect(() => {
  const newCoachSeats: Record<number, LocalSeat[]> = {};
  COACHES.forEach(coach => {
    const seats: LocalSeat[] = [];
    if (coach.type === '6-berth cabin') {
      // 7 khoang, mỗi khoang 3 tầng, mỗi tầng 2 ghế
      for (let khoang = 0; khoang < 7; khoang++) {
        // Tầng 1
        for (let viTri = 0; viTri < 2; viTri++) {
          const soGheThucTe = khoang * 6 + viTri + 1;
          const seatId = `${trainId}-k6-${coach.id}-${soGheThucTe}`;
          
          let price = 850000; // default price
          if (dynamicPrices.length > 0) {
            const item = dynamicPrices.find(item => item.id === seatId);
            if (item) price = item.price;
          }
          
          console.log(`[K6] Khoang ${khoang+1} - Tầng 1 - Ghế ${soGheThucTe} (seatId: ${seatId}): giá = ${price}`);
          seats.push({
            id: `${coach.id}-${soGheThucTe}`,
            row: '',
            column: soGheThucTe,
            floor: 1,
            price: price,
            status: Math.random() > 0.85 ? 'occupied' : 'available',
            behavior: getBehaviorFromColor(coach.id, soGheThucTe - 1),
            nearWC: false,
            nearSimilarBehavior: false,
            passengersNearby: 0
          });
        }
        
        // Tầng 2
        for (let viTri = 0; viTri < 2; viTri++) {
          const soGheThucTe = khoang * 6 + 2 + viTri + 1;
          const seatId = `${trainId}-k6-${coach.id}-${soGheThucTe}`;
          
          let price = 850000; // default price
          if (dynamicPrices.length > 0) {
            const item = dynamicPrices.find(item => item.id === seatId);
            if (item) price = item.price;
          }
          
          console.log(`[K6] Khoang ${khoang+1} - Tầng 2 - Ghế ${soGheThucTe} (seatId: ${seatId}): giá = ${price}`);
          seats.push({
            id: `${coach.id}-${soGheThucTe}`,
            row: '',
            column: soGheThucTe,
            floor: 2,
            price: price,
            status: Math.random() > 0.85 ? 'occupied' : 'available',
            behavior: getBehaviorFromColor(coach.id, soGheThucTe - 1),
            nearWC: false,
            nearSimilarBehavior: false,
            passengersNearby: 0
          });
        }
        
        // Tầng 3
        for (let viTri = 0; viTri < 2; viTri++) {
          const soGheThucTe = khoang * 6 + 4 + viTri + 1;
          const seatId = `${trainId}-k6-${coach.id}-${soGheThucTe}`;
          
          let price = 850000; // default price
          if (dynamicPrices.length > 0) {
            const item = dynamicPrices.find(item => item.id === seatId);
            if (item) price = item.price;
          }
          
          console.log(`[K6] Khoang ${khoang+1} - Tầng 3 - Ghế ${soGheThucTe} (seatId: ${seatId}): giá = ${price}`);
          seats.push({
            id: `${coach.id}-${soGheThucTe}`,
            row: '',
            column: soGheThucTe,
            floor: 3,
            price: price,
            status: Math.random() > 0.85 ? 'occupied' : 'available',
            behavior: getBehaviorFromColor(coach.id, soGheThucTe - 1),
            nearWC: false,
            nearSimilarBehavior: false,
            passengersNearby: 0
          });
        }
      }
    } else if (coach.type === '4-berth cabin') {
      // 7 khoang, mỗi khoang 2 tầng, mỗi tầng 2 ghế
      for (let khoang = 0; khoang < 7; khoang++) {
        // Tầng 1
        for (let viTri = 0; viTri < 2; viTri++) {
          const soGheThucTe = khoang * 4 + viTri + 1;
          const seatId = `${trainId}-k4-${coach.id}-${soGheThucTe}`;
          
          let price = 1200000; // default price
          if (dynamicPrices.length > 0) {
            const item = dynamicPrices.find(item => item.id === seatId);
            if (item) price = item.price;
          }
          
          console.log(`[K4] Khoang ${khoang+1} - Tầng 1 - Ghế ${soGheThucTe} (seatId: ${seatId}): giá = ${price}`);
          seats.push({
            id: `${coach.id}-${soGheThucTe}`,
            row: '',
            column: soGheThucTe,
            floor: 1,
            price: price,
            status: Math.random() > 0.85 ? 'occupied' : 'available',
            behavior: getBehaviorFromColor(coach.id, soGheThucTe - 1),
            nearWC: false,
            nearSimilarBehavior: false,
            passengersNearby: 0
          });
        }
        // Tầng 2
        for (let viTri = 0; viTri < 2; viTri++) {
          const soGheThucTe = khoang * 4 + 2 + viTri + 1;
          const seatId = `${trainId}-k4-${coach.id}-${soGheThucTe}`;
          
          let price = 1200000; // default price
          if (dynamicPrices.length > 0) {
            const item = dynamicPrices.find(item => item.id === seatId);
            if (item) price = item.price;
          }
          
          console.log(`[K4] Khoang ${khoang+1} - Tầng 2 - Ghế ${soGheThucTe} (seatId: ${seatId}): giá = ${price}`);
          seats.push({
            id: `${coach.id}-${soGheThucTe}`,
            row: '',
            column: soGheThucTe,
            floor: 2,
            price: price,
            status: Math.random() > 0.85 ? 'occupied' : 'available',
            behavior: getBehaviorFromColor(coach.id, soGheThucTe - 1),
            nearWC: false,
            nearSimilarBehavior: false,
            passengersNearby: 0
          });
        }
      }
    } else {
      // Toa ngồi mềm, gối mềm: giữ nguyên logic cũ
      for (let i = 1; i <= coach.seats; i++) {
        let dynamicPrice = 0;
        let seatId = '';
        if (coach.type === 'Soft seat' || coach.type === 'Gối mềm') {
          const carNumber = coach.id;
          seatId = `${trainId}-ngoi-${carNumber}-${i}`;
        }
        if (seatId && dynamicPrices.length > 0) {
          const dynamicItem = dynamicPrices.find(item => item.id === seatId);
          if (dynamicItem) {
            dynamicPrice = dynamicItem.price;
          }
        }
        const defaultPrice = 850000;
        const price = dynamicPrice || defaultPrice;
        seats.push({
          id: `${coach.id}-${i}`,
          row: '',
          column: i,
          floor: 1,
          price: price,
          status: Math.random() > 0.85 ? 'occupied' : 'available',
          behavior: getBehaviorFromColor(coach.id, i - 1),
          nearWC: false,
          nearSimilarBehavior: false,
          passengersNearby: 0
        });
      }
    }
    newCoachSeats[coach.id] = seats;
  });
  setCoachSeats(newCoachSeats);
}, [dynamicPrices, trainId]);

  // Tổng số ghế còn lại cho từng toa
  const getAvailableCount = (coachId: number) =>
    coachSeats[coachId]?.filter(s => s.status === 'available').length || 0;

  // Hàm tính behavior dựa trên noise level (màu sắc)
  const getBehaviorFromColor = (coachId: number, seatIndex: number): 'quiet' | 'social' => {
    const coach = COACHES.find(c => c.id === coachId);
    if (!coach) return 'social';

    let noiseValue = 0;

    // Toa 1,2: dùng chung 1 dải màu
    if ([1,2].includes(coachId)) {
      const noise1 = NOISE_KHOANGS_1.flat();
      const noise2 = NOISE_KHOANGS_2.flat();
      const flatNoise = [...noise1, ...noise2];
      let globalIdx = seatIndex;
      if (coachId === 2) globalIdx += noise1.length;
      noiseValue = flatNoise[globalIdx] || 0;
      const min = Math.min(...flatNoise);
      const max = Math.max(...flatNoise);
      const percent = (noiseValue - min) / (max - min);
      // Nếu percent > 0.5 thì quiet (màu xanh), ngược lại social (màu cam đỏ)
      return percent > 0.5 ? 'quiet' : 'social';
    }

    // Toa 3,4,5 và các toa khác tương tự
    if ([3,4,5].includes(coachId)) {
      const noise3 = NOISE_KHOANGS_3.flat();
      const noise4 = NOISE_KHOANGS_4.flat();
      const noise5 = NOISE_KHOANGS_5.flat();
      const flatNoise = [...noise3, ...noise4, ...noise5];
      let globalIdx = seatIndex;
      if (coachId === 4) globalIdx += noise3.length;
      if (coachId === 5) globalIdx += noise3.length + noise4.length;
      noiseValue = flatNoise[globalIdx] || 0;
      const min = Math.min(...flatNoise);
      const max = Math.max(...flatNoise);
      const percent = (noiseValue - min) / (max - min);
      return percent > 0.5 ? 'quiet' : 'social';
    }

    // Mặc định cho các toa khác
    return Math.random() > 0.5 ? 'quiet' : 'social';
  };

  // Hàm tính toán màu sắc cho ghế dựa trên toa và vị trí
  const getSeatColor = (coachId: number, seatIndex: number) => {
    const coach = COACHES.find(c => c.id === coachId);
    if (!coach) return "#e0e0e0";

    // Toa 1,2: dùng chung 1 dải màu
    if ([1,2].includes(coachId)) {
      // Ghép noise của toa 1 và 2
      const noise1 = NOISE_KHOANGS_1.flat();
      const noise2 = NOISE_KHOANGS_2.flat();
      const flatNoise = [...noise1, ...noise2];
      let globalIdx = seatIndex;
      if (coachId === 2) globalIdx += noise1.length;
      const min = Math.min(...flatNoise);
      const max = Math.max(...flatNoise);
      const value = flatNoise[globalIdx];
      const percent = (value - min) / (max - min);
      function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
      const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 34, g: 197, b: 94 };
      const r = Math.round(lerp(c1.r, c2.r, percent));
      const g = Math.round(lerp(c1.g, c2.g, percent));
      const b = Math.round(lerp(c1.b, c2.b, percent));
      return `rgb(${r},${g},${b})`;
    }

    // Toa 3,4,5: dùng chung 1 dải màu
    if ([3,4,5].includes(coachId)) {
      const noise3 = NOISE_KHOANGS_3.flat();
      const noise4 = NOISE_KHOANGS_4.flat();
      const noise5 = NOISE_KHOANGS_5.flat();
      const flatNoise = [...noise3, ...noise4, ...noise5];
      let globalIdx = seatIndex;
      if (coachId === 4) globalIdx += noise3.length;
      if (coachId === 5) globalIdx += noise3.length + noise4.length;
      const min = Math.min(...flatNoise);
      const max = Math.max(...flatNoise);
      const value = flatNoise[globalIdx];
      const percent = (value - min) / (max - min);
      function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
      const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 34, g: 197, b: 94 };
      const r = Math.round(lerp(c1.r, c2.r, percent));
      const g = Math.round(lerp(c1.g, c2.g, percent));
      const b = Math.round(lerp(c1.b, c2.b, percent));
      return `rgb(${r},${g},${b})`;
    }
    // Toa 6-10: dùng chung 1 dải màu, flatten theo Toa→Khoang→Tầng (2→1), không phân biệt giường
    if ([6,7,8,9,10].includes(coachId)) {
      const flatNoise = flattenNoiseMatrixForCoaches6to10_strictOrder();
      // Mỗi toa: 7 khoang, 2 tầng
      const floorsPerCoach = 7 * 2;
      // Tính vị trí khoang, tầng từ seatIndex
      const khoang = Math.floor(seatIndex / 4);
      const seatInKhoang = seatIndex % 4;
      const tang = Math.floor(seatInKhoang / 2); // 0: tầng 1, 1: tầng 2
      const tangInFlatten = 1 - tang;
      const coachOffset = (coachId - 6) * floorsPerCoach;
      const globalIdx = coachOffset + khoang * 2 + tangInFlatten;
      if (globalIdx >= flatNoise.length) return "#e0e0e0";
      const min = Math.min(...flatNoise);
      const max = Math.max(...flatNoise);
      const value = flatNoise[globalIdx];
      const percent = (value - min) / (max - min);
      function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
      const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 34, g: 197, b: 94 };
      const r = Math.round(lerp(c1.r, c2.r, percent));
      const g = Math.round(lerp(c1.g, c2.g, percent));
      const b = Math.round(lerp(c1.b, c2.b, percent));
      return `rgb(${r},${g},${b})`;
    }
    // ... giữ nguyên logic cũ cho các toa khác ...

    // Xác định loại toa và lấy ma trận noise tương ứng
    let noiseMatrix: number[][] = [];
    let colorFunction: (value: number) => string = () => "#e0e0e0";

    if (coach.type === 'Soft seat' || coach.type === 'Gối mềm') {
      // Toa ngồi: sử dụng ma trận noise cơ bản và gradient cam-xanh lá
      if (coachId === 1) {
        noiseMatrix = NOISE_KHOANGS_1;
        colorFunction = (value: number) => {
          const min = 1200, max = 1335;
          const percent = (value - min) / (max - min);
          function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
          const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 34, g: 197, b: 94 };
          const r = Math.round(lerp(c1.r, c2.r, percent));
          const g = Math.round(lerp(c1.g, c2.g, percent));
          const b = Math.round(lerp(c1.b, c2.b, percent));
          return `rgb(${r},${g},${b})`;
        };
      } else if (coachId === 2) {
        noiseMatrix = NOISE_KHOANGS_2;
        colorFunction = (value: number) => {
          const min = 1340, max = 1475;
          const percent = (value - min) / (max - min);
          function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
          const c1 = { r: 249, g: 115, b: 22 }, c2 = { r: 34, g: 197, b: 94 };
          const r = Math.round(lerp(c1.r, c2.r, percent));
          const g = Math.round(lerp(c1.g, c2.g, percent));
          const b = Math.round(lerp(c1.b, c2.b, percent));
          return `rgb(${r},${g},${b})`;
        };
      }
    } else if (coach.type === '6-berth cabin') {
      if (coachId === 3) {
        noiseMatrix = NOISE_KHOANGS_3;
        colorFunction = getNoiseColor3_v2;
      } else if (coachId === 4) {
        noiseMatrix = NOISE_KHOANGS_4;
        colorFunction = getNoiseColor4_v2;
      } else if (coachId === 5) {
        noiseMatrix = NOISE_KHOANGS_5;
        colorFunction = getNoiseColor5_v2;
      }
    } else if (coach.type === '4-berth cabin') {
      if (coachId === 5) {
        noiseMatrix = NOISE_KHOANGS_4_5;
        colorFunction = getNoiseColor4_5_v2;
      } else if (coachId === 6) {
        noiseMatrix = NOISE_KHOANGS_4_6;
        colorFunction = getNoiseColor4_6_v2;
      } else if (coachId === 7) {
        noiseMatrix = NOISE_KHOANGS_4_7;
        colorFunction = getNoiseColor4_7_v2;
      } else if (coachId === 8) {
        noiseMatrix = NOISE_KHOANGS_4_8;
        colorFunction = getNoiseColor4_8_v2;
      } else if (coachId === 9) {
        noiseMatrix = NOISE_KHOANGS_4_9;
        colorFunction = getNoiseColor4_9_v2;
      } else if (coachId === 10) {
        noiseMatrix = NOISE_KHOANGS_4_10;
        colorFunction = getNoiseColor4_10_v2;
      }
    }

    if (noiseMatrix.length === 0) {
      return "#e0e0e0";
    }

    let khoangIdx = 0;
    let tangIdx = 0;
    let seatInTang = 0;

    if (coach.type === '4-berth cabin') {
      // 7 khoang, mỗi khoang 2 tầng, mỗi tầng 2 ghế (4 ghế/khoang)
      khoangIdx = Math.floor(seatIndex / 4);
      const seatInKhoang = seatIndex % 4;
      // Đảo ngược chiều index để dải màu chuyển đều từ đỏ sang xanh
      seatInTang = Math.floor(seatInKhoang / 2); // cột
      tangIdx = seatInKhoang % 2; // hàng
    } else if (coach.type === '6-berth cabin') {
      khoangIdx = Math.floor(seatIndex / 6);
      const seatInKhoang = seatIndex % 6;
      tangIdx = Math.floor(seatInKhoang / 2);
      seatInTang = seatInKhoang % 2;
    } else if (coach.type === 'Soft seat' || coach.type === 'Gối mềm') {
      khoangIdx = Math.floor(seatIndex / 7);
      seatInTang = seatIndex % 7;
      tangIdx = 0;
    }

    if (
      khoangIdx < noiseMatrix.length &&
      ((coach.type === '4-berth cabin' && tangIdx < 2 && seatInTang < 2) ||
       (coach.type === '6-berth cabin' && tangIdx < 3 && seatInTang < 2) ||
       (coach.type === 'Soft seat' || coach.type === 'Gối mềm'))
    ) {
      const noiseValue = noiseMatrix[khoangIdx][tangIdx * 2 + seatInTang];
      return colorFunction(noiseValue);
    }

    return "#e0e0e0";
  };

  // Hàm gợi ý chọn ghế liền kề cho nhóm
  // ==================== AUTO SEAT SELECTION LOGIC ====================
  
  // Tính khoảng cách ghế từ vị trí toilet (toilet ở góc phải trên)
  const getDistanceFromToilet = (seatIndex: number, coachType: string) => {
    if (coachType === 'Soft seat') {
      // Toa ngồi: toilet ở vị trí (0,3) trong grid 4 cột
      const row = Math.floor(seatIndex / 4);
      const col = seatIndex % 4;
      return Math.sqrt((row - 0) * (row - 0) + (col - 3) * (col - 3));
    } else if (coachType === '6-berth cabin') {
      // Toa nằm 6: toilet ở đầu toa, ưu tiên khoang 1
      const compartment = Math.floor(seatIndex / 6);
      return compartment; // Khoang càng gần 0 càng gần toilet
    } else if (coachType === '4-berth cabin') {
      // Toa nằm 4: toilet ở đầu toa, ưu tiên khoang 1
      const compartment = Math.floor(seatIndex / 4);
      return compartment; // Khoang càng gần 0 càng gần toilet
    }
    return seatIndex;
  };

  // Kiểm tra khoang có đủ chỗ trống không
  const isCompartmentEmpty = (coachId: number, compartmentIndex: number, seatCount: number) => {
    const seats = coachSeats[coachId] || [];
    const compartmentSeats = seats.slice(compartmentIndex * seatCount, (compartmentIndex + 1) * seatCount);
    return compartmentSeats.every(seat => seat && seat.status === 'available');
  };

  // Tìm khoang trống gần nhất cho nhóm
  const findNearestEmptyCompartment = (coachId: number, seatCount: number) => {
    const coach = COACHES.find(c => c.id === coachId);
    if (!coach) return -1;

    const compartmentCount = Math.floor(coach.seats / seatCount);
    
    for (let i = 0; i < compartmentCount; i++) {
      if (isCompartmentEmpty(coachId, i, seatCount)) {
        return i;
      }
    }
    return -1;
  };

  // Chọn ghế cho nhóm có trẻ em/người già (gần toilet)
  const selectSeatsNearToilet = (totalSeats: number) => {
    const selectedSeats: string[] = [];
    
    // Tìm toa có chỗ và ưu tiên toa ngồi (gần toilet hơn)
    for (const coach of COACHES) {
      const availableSeats = (coachSeats[coach.id] || [])
        .map((seat, index) => ({ seat, index }))
        .filter(({seat}) => seat && seat.status === 'available')
        .sort((a, b) => getDistanceFromToilet(a.index, coach.type) - getDistanceFromToilet(b.index, coach.type));

      if (availableSeats.length >= totalSeats) {
        for (let i = 0; i < totalSeats; i++) {
          selectedSeats.push(availableSeats[i].seat.id);
        }
        setSelectedCoachIdx(COACHES.findIndex(c => c.id === coach.id));
        break;
      }
    }
    
    return selectedSeats;
  };

  // Chọn khoang trống cho nhóm 4 người
  const selectGroup4Compartment = (numPassengers = 4) => {
    // Ưu tiên toa nằm 4
    for (const coach of COACHES.filter(c => c.type === '4-berth cabin')) {
      const compartmentIndex = findNearestEmptyCompartment(coach.id, 4);
      if (compartmentIndex !== -1) {
        const seats = coachSeats[coach.id] || [];
        const compartmentSeats = seats.slice(compartmentIndex * 4, (compartmentIndex + 1) * 4);
        setSelectedCoachIdx(COACHES.findIndex(c => c.id === coach.id));
        // Chỉ chọn đúng số ghế bằng số hành khách
        return compartmentSeats.slice(0, numPassengers).map(seat => seat.id);
      }
    }

    // Nếu không có toa 4, tìm ghế liền kề trong toa khác
    for (const coach of COACHES) {
      const availableSeats = (coachSeats[coach.id] || [])
        .filter(seat => seat && seat.status === 'available');
      
      if (availableSeats.length >= numPassengers) {
        setSelectedCoachIdx(COACHES.findIndex(c => c.id === coach.id));
        return availableSeats.slice(0, numPassengers).map(seat => seat.id);
      }
    }
    
    return [];
  };

  // Chọn khoang trống cho nhóm 6 người
  const selectGroup6Compartment = (numPassengers = 6) => {
    // Ưu tiên toa nằm 6
    for (const coach of COACHES.filter(c => c.type === '6-berth cabin')) {
      const compartmentIndex = findNearestEmptyCompartment(coach.id, 6);
      if (compartmentIndex !== -1) {
        const seats = coachSeats[coach.id] || [];
        const compartmentSeats = seats.slice(compartmentIndex * 6, (compartmentIndex + 1) * 6);
        setSelectedCoachIdx(COACHES.findIndex(c => c.id === coach.id));
        // Chỉ chọn đúng số ghế bằng số hành khách
        return compartmentSeats.slice(0, numPassengers).map(seat => seat.id);
      }
    }

    // Nếu không có toa 6, tìm ghế liền kề trong toa khác
    for (const coach of COACHES) {
      const availableSeats = (coachSeats[coach.id] || [])
        .filter(seat => seat && seat.status === 'available');
      
      if (availableSeats.length >= numPassengers) {
        setSelectedCoachIdx(COACHES.findIndex(c => c.id === coach.id));
        return availableSeats.slice(0, numPassengers).map(seat => seat.id);
      }
    }
    
    return [];
  };

  // Chọn ghế cho nhóm lẻ (cùng toa)
  const selectSameCoachSeats = (totalSeats: number) => {
    for (const coach of COACHES) {
      const availableSeats = (coachSeats[coach.id] || [])
        .filter(seat => seat && seat.status === 'available');
      
      if (availableSeats.length >= totalSeats) {
        setSelectedCoachIdx(COACHES.findIndex(c => c.id === coach.id));
        return availableSeats.slice(0, totalSeats).map(seat => seat.id);
      }
    }
    return [];
  };

  // Chọn ghế cho nhóm lớn (chia nhóm)
  const selectMixedGroupSeats = (totalSeats: number) => {
    const selectedSeats: string[] = [];
    
    if (totalSeats === 5) {
      // Chia 4 + 1: Chọn đầy đủ 4 ghế của khoang và tìm 1 ghế gần nhất
      const group4Seats = selectGroup4Compartment(4);
      if (group4Seats.length === 4) {
        selectedSeats.push(...group4Seats);
        
        // Tìm 1 ghế gần nhất với khoang 4 giường đã chọn
        const mainCoachId = COACHES[selectedCoachIdx].id;
        const allSeats = coachSeats[mainCoachId] || [];
        const availableSeats = allSeats.filter(seat => 
          seat && seat.status === 'available' && !selectedSeats.includes(seat.id)
        );
        
        if (availableSeats.length > 0) {
          // Tính khoảng cách từ mỗi ghế available đến khoang 4 giường đã chọn
          const group4SeatIndices = group4Seats.map(seatId => 
            allSeats.findIndex(seat => seat && seat.id === seatId)
          ).filter(index => index !== -1);
          
          if (group4SeatIndices.length > 0) {
            // Tìm range của khoang 4 giường
            const minIndex = Math.min(...group4SeatIndices);
            const maxIndex = Math.max(...group4SeatIndices);
            const compartmentCenter = (minIndex + maxIndex) / 2;
            
            // Tìm ghế available gần compartment center nhất
            let nearestSeat = availableSeats[0];
            let minDistance = Math.abs(allSeats.findIndex(s => s && s.id === nearestSeat.id) - compartmentCenter);
            
            for (const seat of availableSeats) {
              const seatIndex = allSeats.findIndex(s => s && s.id === seat.id);
              const distance = Math.abs(seatIndex - compartmentCenter);
              if (distance < minDistance) {
                minDistance = distance;
                nearestSeat = seat;
              }
            }
            
            selectedSeats.push(nearestSeat.id);
          } else {
            // Fallback: chọn ghế đầu tiên nếu không tìm được khoảng cách
            selectedSeats.push(availableSeats[0].id);
          }
        }
      }
    } else if (totalSeats === 7) {
      // Chia 6 + 1: Chọn đầy đủ 6 ghế của khoang và tìm 1 ghế gần nhất
      const group6Seats = selectGroup6Compartment(6);
      if (group6Seats.length === 6) {
        selectedSeats.push(...group6Seats);
        
        // Tìm 1 ghế gần nhất với khoang 6 giường đã chọn
        const mainCoachId = COACHES[selectedCoachIdx].id;
        const allSeats = coachSeats[mainCoachId] || [];
        const availableSeats = allSeats.filter(seat => 
          seat && seat.status === 'available' && !selectedSeats.includes(seat.id)
        );
        
        if (availableSeats.length > 0) {
          // Tính khoảng cách từ mỗi ghế available đến khoang 6 giường đã chọn
          // Giả sử ghế được sắp xếp theo thứ tự trong compartment
          const group6SeatIndices = group6Seats.map(seatId => 
            allSeats.findIndex(seat => seat && seat.id === seatId)
          ).filter(index => index !== -1);
          
          if (group6SeatIndices.length > 0) {
            // Tìm range của khoang 6 giường
            const minIndex = Math.min(...group6SeatIndices);
            const maxIndex = Math.max(...group6SeatIndices);
            const compartmentCenter = (minIndex + maxIndex) / 2;
            
            // Tìm ghế available gần compartment center nhất
            let nearestSeat = availableSeats[0];
            let minDistance = Math.abs(allSeats.findIndex(s => s && s.id === nearestSeat.id) - compartmentCenter);
            
            for (const seat of availableSeats) {
              const seatIndex = allSeats.findIndex(s => s && s.id === seat.id);
              const distance = Math.abs(seatIndex - compartmentCenter);
              if (distance < minDistance) {
                minDistance = distance;
                nearestSeat = seat;
              }
            }
            
            selectedSeats.push(nearestSeat.id);
          } else {
            // Fallback: chọn ghế đầu tiên nếu không tìm được khoảng cách
            selectedSeats.push(availableSeats[0].id);
          }
        }
      }
    } else {
      // Nhóm khác: chọn cùng toa
      return selectSameCoachSeats(totalSeats);
    }
    
    return selectedSeats;
  };

  // Function chính để tự động chọn ghế
  const autoSelectSeats = () => {
    if (totalPassengers === 0) return;

    let selectedSeats: string[] = [];
    const hasChildrenOrElderly = passenger.child > 0 || passenger.elderly > 0;

    console.log('Auto selecting seats for:', {
      totalPassengers,
      hasChildrenOrElderly,
      passenger
    });

    if (hasChildrenOrElderly) {
      // Có trẻ em hoặc người già -> chọn gần toilet
      selectedSeats = selectSeatsNearToilet(totalPassengers);
      console.log('Selected seats near toilet:', selectedSeats);
    } else if (totalPassengers === 3) {
      // Nhóm 3 người (không có trẻ em/người già) -> ưu tiên khoang 4 giường nhưng chỉ chọn 3 ghế
      selectedSeats = selectGroup4Compartment(3);
      console.log('Selected 3 seats in 4-bed compartment:', selectedSeats);
    } else if (totalPassengers === 4) {
      // Nhóm 4 người -> ưu tiên khoang 4
      selectedSeats = selectGroup4Compartment(4);
      console.log('Selected group 4 compartment:', selectedSeats);
    } else if (totalPassengers === 5) {
      // Nhóm 5 người (không có trẻ em/người già) -> ưu tiên khoang 6 giường nhưng chỉ chọn 5 ghế
      selectedSeats = selectGroup6Compartment(5);
      console.log('Selected 5 seats in 6-bed compartment:', selectedSeats);
    } else if (totalPassengers === 6) {
      // Nhóm 6 người -> ưu tiên khoang 6
      selectedSeats = selectGroup6Compartment(6);
      console.log('Selected group 6 compartment:', selectedSeats);
    } else if (totalPassengers === 7) {
      // Nhóm 7 người (không có trẻ em/người già) -> ưu tiên khoang 6 giường + 1 ghế kế bên
      selectedSeats = selectMixedGroupSeats(totalPassengers);
      console.log('Selected 6+1 arrangement for 7 people:', selectedSeats);
    } else {
      // Các trường hợp khác -> chọn cùng toa
      selectedSeats = selectSameCoachSeats(totalPassengers);
      console.log('Selected default seats:', selectedSeats);
    }

    if (selectedSeats.length > 0) {
      setSelectedSeatIds(selectedSeats);
      
      // Hiển thị thông báo về chiến lược đã áp dụng
      const message = hasChildrenOrElderly 
        ? `🎯 Auto-selected ${selectedSeats.length} seats near toilet for children/elderly comfort.`
        : totalPassengers === 3
        ? `🎯 Auto-selected 4-bed compartment for your group of 3.`
        : totalPassengers === 4
        ? `🎯 Auto-selected 4-bed compartment for your group.`
        : totalPassengers === 5
        ? `🎯 Auto-selected 6-bed compartment for your group of 5.`
        : totalPassengers === 6
        ? `🎯 Auto-selected 6-bed compartment for your group.`
        : totalPassengers === 7
        ? `🎯 Auto-selected 6-bed compartment + 1 adjacent seat for your group of 7.`
        : `🎯 Auto-selected ${selectedSeats.length} seats with optimal arrangement.`;
      
      setAutoSelectMessage(message);
      
      // Xóa thông báo sau 5 giây
      setTimeout(() => {
        setAutoSelectMessage('');
      }, 5000);
    } else {
      setAutoSelectMessage('❌ Unable to find optimal seat arrangement. Please select seats manually.');
      setTimeout(() => {
        setAutoSelectMessage('');
      }, 3000);
    }
  };

  // ==================== END AUTO SEAT SELECTION LOGIC ====================

  const handleSeatSelect = (seatId: string) => {
    const seat = coachSeats[COACHES[selectedCoachIdx].id]?.find(s => s.id === seatId);
    if (!seat || seat.status !== 'available') return;
    
    setSelectedSeatIds(prev => {
      const newSelected = [...prev];
      const idx = newSelected.indexOf(seatId);
      
      if (idx > -1) {
        // Bỏ chọn ghế
        newSelected.splice(idx, 1);
      } else {
        // Chọn ghế mới
        if (newSelected.length < totalPassengers) {
          newSelected.push(seatId);
          
          // Thông báo khi chọn đủ ghế
          if (newSelected.length === totalPassengers) {
            // Có thể thêm hiệu ứng hoặc âm thanh thông báo ở đây
            console.log('All seats selected!');
          }
        } else {
          // Thông báo khi đã chọn đủ ghế
          alert(`You have already selected ${totalPassengers} seat${totalPassengers > 1 ? 's' : ''}. Please unselect a seat first if you want to choose a different one.`);
          return prev; // Không thay đổi
        }
      }
      
      return newSelected;
    });
  };

  // Chuyển sang nhập thông tin hành khách
  const handleProceedToPassengerInfo = () => {
    if (selectedSeatIds.length === 0 || selectedSeatIds.length < totalPassengers) return;
    const seatParams = selectedSeatIds.join(',');
    const totalPrice = selectedSeatIds.reduce((total, seatId) => {
      const seat = Object.values(coachSeats).flat().find(s => s.id === seatId);
      return total + (seat?.price || 0);
    }, 0);
    // Lưu ticketInfo vào localStorage để các bước sau dùng lại
    localStorage.setItem('ticketInfo', JSON.stringify({
      trainId: searchParams.get('trainId'),
      trainName: searchParams.get('trainName'),
      selectedSeats: seatParams,
      totalPrice,
      from,
      to,
      departDate,
      returnDate: searchParams.get('returnDate'),
      isRoundTrip: searchParams.get('isRoundTrip') === 'true',
      passenger,
      totalPassengers
    }));
    // Điều hướng sang trang nhập thông tin hành khách
    const params = new URLSearchParams();
    if (searchParams.get('trainId')) params.append('trainId', searchParams.get('trainId') || '');
    if (searchParams.get('trainName')) params.append('trainName', searchParams.get('trainName') || '');
    if (seatParams) params.append('selectedSeats', seatParams);
    params.append('totalPrice', totalPrice.toString());
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (departDate) params.append('departDate', departDate);
    if (searchParams.get('returnDate')) params.append('returnDate', searchParams.get('returnDate') || '');
    params.append('isRoundTrip', searchParams.get('isRoundTrip') || 'false');
    params.append('passenger', JSON.stringify(passenger));
    navigate(`/passenger-info?${params.toString()}`);
  };

  // Lấy mã tàu, loại bỏ chữ 'Tàu' nếu có
  let trainName = searchParams.get('trainName') || 'SE?';
  trainName = trainName.replace(/^Tàu\s*/i, '');

  // ====== SALESFORCE-STYLE FILTERING SYSTEM ======
  // State cho bộ lọc nâng cao (Salesforce-style)
  const [filterMinPrice, setFilterMinPrice] = useState(100000);
  const [filterMaxPrice, setFilterMaxPrice] = useState(2000000);
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [filteredSeatIds, setFilteredSeatIds] = useState<string[]>([]);
  const [filterDebounceTimer, setFilterDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  
  // Salesforce-style Record Type filtering
  const [selectedRecordTypes, setSelectedRecordTypes] = useState<string[]>(['standard', 'medium_priority', 'high_priority']);
  
  // Salesforce-style Priority Preference
  const [priorityPreference, setPriorityPreference] = useState<'all' | 'high_only'>('all');

  // Debug test function
  const testFilterSystem = () => {
    console.log('\n🧪🧪🧪 STARTING FILTER SYSTEM TEST 🧪🧪🧪');
    
    // Test 1: Check coach seats data
    console.log('Test 1 - Coach Seats Data:');
    console.log('Available coaches:', Object.keys(coachSeats));
    console.log('Current coach ID:', COACHES[selectedCoachIdx].id);
    console.log('Current coach seats count:', coachSeats[COACHES[selectedCoachIdx].id]?.length || 0);
    
    // Test 2: Check Record Type config
    console.log('\nTest 2 - Record Type Config:');
    console.log('Record Type Config:', recordTypeConfig);
    console.log('Selected Record Types:', selectedRecordTypes);
    
    // Test 3: Test seat type detection
    console.log('\nTest 3 - Seat Type Detection:');
    const currentCoachSeats = coachSeats[COACHES[selectedCoachIdx].id] || [];
    if (currentCoachSeats.length > 0) {
      const testSeat = currentCoachSeats[0];
      console.log('Sample seat:', testSeat);
      
      // Test coach-based detection
      const coachId = COACHES[selectedCoachIdx].id;
      let detectedType = '';
      if (coachId === 1 || coachId === 2) {
        detectedType = 'seat';
      } else if (coachId >= 3 && coachId <= 5) {
        detectedType = 'compartment_6';
      } else if (coachId >= 6 && coachId <= 10) {
        detectedType = 'compartment_4';
      }
      console.log(`Coach ${coachId} should have type: ${detectedType}`);
    }
    
    // Test 4: Check filter state
    console.log('\nTest 4 - Filter State:');
    console.log('Filter active:', isFilterActive);
    console.log('Filtered seat IDs:', filteredSeatIds);
    
    console.log('\n🏁 FILTER SYSTEM TEST COMPLETE 🏁');
    alert('Filter system test complete! Check console for details.');
  };
  React.useEffect(() => {
    console.log('🔄 Selected Record Types changed:', selectedRecordTypes);
  }, [selectedRecordTypes]);

  React.useEffect(() => {
    console.log('🔄 Priority Preference changed:', priorityPreference);
  }, [priorityPreference]);

  React.useEffect(() => {
    console.log('🔄 Filter active state changed:', isFilterActive);
  }, [isFilterActive]);

  // Debug logging for coachSeats changes
  React.useEffect(() => {
    console.log('🚂 CoachSeats data changed:');
    console.log('Available coaches:', Object.keys(coachSeats));
    Object.keys(coachSeats).forEach(coachIdStr => {
      const coachId = parseInt(coachIdStr);
      console.log(`Coach ${coachId}: ${coachSeats[coachId]?.length || 0} seats`);
    });
  }, [coachSeats]);

  // Debug logging for seats data changes  
  React.useEffect(() => {
    console.log('💺 Seats data changed:', seats.length, 'seats total');
    if (seats.length > 0) {
      console.log('💺 Sample seat structure:', seats[0]);
      console.log('💺 Sample seat properties:', Object.keys(seats[0]));
      // Log seats from different coaches to see structure variety
      const seatsByCoach: Record<string, any[]> = {};
      seats.forEach(seat => {
        const coachId = (seat as any).coachId || (seat as any).coach || seat.id?.split('-')[1];
        if (!seatsByCoach[coachId]) seatsByCoach[coachId] = [];
        seatsByCoach[coachId].push(seat);
      });
      console.log('💺 Seats grouped by coach:', Object.keys(seatsByCoach).map(coachId => 
        `Coach ${coachId}: ${seatsByCoach[coachId].length} seats`
      ));
      
      // Log sample seats from different coach types
      if (seatsByCoach['1']) console.log('💺 Coach 1 sample seat (should be seating):', seatsByCoach['1'][0]);
      if (seatsByCoach['3']) console.log('💺 Coach 3 sample seat (should be k6):', seatsByCoach['3'][0]);
      if (seatsByCoach['6']) console.log('💺 Coach 6 sample seat (should be k4):', seatsByCoach['6'][0]);
    }
  }, [seats]);

  // Record Type Configuration (Salesforce-style object mapping)
  const recordTypeConfig = {
    standard: {
      label: 'Standard Seats',
      description: 'Regular seating with basic comfort',
      criteria: {
        seatTypes: ['seat'],
        noiseLevel: ['quiet', 'social'],
        coachPosition: [1, 2], // Toa 1-2
        priorityScore: 1
      }
    },
    medium_priority: {
      label: '6-Berth Cabins',
      description: 'Shared sleeper compartments (6 beds)',
      criteria: {
        seatTypes: ['compartment_6'],
        noiseLevel: ['quiet', 'social'],
        coachPosition: [3, 4, 5], // Toa 3-5
        priorityScore: 2
      }
    },
    high_priority: {
      label: '4-Berth Cabins',
      description: 'Premium sleeper compartments (4 beds)',
      criteria: {
        seatTypes: ['compartment_4'],
        noiseLevel: ['quiet', 'social'],
        coachPosition: [6, 7, 8, 9, 10], // Toa 6-10
        priorityScore: 3
      }
    }
  };

  // Legacy compatibility state (để giữ tương thích với code cũ)
  const [behavior, setBehavior] = useState<'quiet' | 'noise' | null>(null);
  const [seatTypeFilters, setSeatTypeFilters] = useState({
    seat: true,
    compartment_4: true,
    compartment_6: true
  });
  const [seatType, setSeatType] = useState<'seat' | 'k4' | 'k6'>('seat');

  // Salesforce-style priority scoring function
  const getPriorityScore = (seat: LocalSeat): number => {
    let score = 0;
    
    // Noise level scoring (decreases by coach position as requested)
    const coachId = COACHES[selectedCoachIdx].id;
    if (seat.behavior === 'quiet') {
      score += Math.max(0, 11 - coachId); // Decreasing noise by coach position
    } else if (seat.behavior === 'social') {
      score += Math.max(0, coachId - 1); // Increasing noise by coach position
    }
    
    // Seat type scoring
    if (seat.id.includes('-k4-')) score += 30; // 4-berth cabin (highest priority)
    else if (seat.id.includes('-k6-')) score += 20; // 6-berth cabin (medium priority)
    else if (seat.id.includes('-ngoi-')) score += 10; // Seat (standard priority)
    
    // Comfort factors
    if (!seat.nearWC) score += 5; // Bonus for not being near toilet
    if (seat.nearSimilarBehavior) score += 3; // Bonus for being near similar behavior passengers
    
    return score;
  };

  // Function to check if seat matches Record Type criteria
  const matchesRecordTypeCriteria = (seat: LocalSeat, recordType: string): boolean => {
    const config = recordTypeConfig[recordType as keyof typeof recordTypeConfig];
    if (!config) {
      console.log(`⚠️ No config found for record type: ${recordType}`);
      return false;
    }
    
    const coachId = COACHES[selectedCoachIdx].id;
    console.log(`🔍 Checking seat ${seat.id} against ${recordType} for coach ${coachId}`);
    
    // Check coach position criteria
    if (!config.criteria.coachPosition.includes(coachId)) {
      console.log(`❌ Coach ${coachId} not in allowed positions:`, config.criteria.coachPosition);
      return false;
    }
    console.log(`✅ Coach ${coachId} matches position criteria`);
    
    // Check seat type criteria - improved logic with better detection
    let seatTypeMatches = false;
    
    // Debug: First let's see what the actual seat object looks like
    console.log(`🔍 DEBUGGING SEAT OBJECT:`, JSON.stringify(seat, null, 2));
    
    // Determine actual seat type from multiple sources
    let actualSeatType = '';
    
    // Method 1: Check seat ID patterns
    if (seat.id.includes('-ngoi-') || seat.id.includes('ngoi')) {
      actualSeatType = 'seat';
    } else if (seat.id.includes('-k4-') || seat.id.includes('k4')) {
      actualSeatType = 'compartment_4';
    } else if (seat.id.includes('-k6-') || seat.id.includes('k6')) {
      actualSeatType = 'compartment_6';
    }
    
    // Method 2: If ID pattern fails, determine by coach position (more reliable)
    if (!actualSeatType) {
      if (coachId === 1 || coachId === 2) {
        actualSeatType = 'seat'; // Toa 1-2 are soft seats
      } else if (coachId >= 3 && coachId <= 5) {
        actualSeatType = 'compartment_6'; // Toa 3-5 are 6-berth cabins
      } else if (coachId >= 6 && coachId <= 10) {
        actualSeatType = 'compartment_4'; // Toa 6-10 are 4-berth cabins
      }
    }
    
    console.log(`🪑 Seat ${seat.id} determined type: ${actualSeatType} (Coach ${coachId})`);
    console.log(`📋 Record type ${recordType} allows:`, config.criteria.seatTypes);
    
    // Check if actual seat type is in the allowed types for this record type
    seatTypeMatches = config.criteria.seatTypes.includes(actualSeatType);
    
    if (!seatTypeMatches) {
      console.log(`❌ Seat type ${actualSeatType} not allowed for ${recordType}`);
      return false;
    }
    console.log(`✅ Seat type ${actualSeatType} matches criteria`);
    
    // Check noise level criteria (if behavior filter is applied)
    if (behavior) {
      const noiseLevel = behavior === 'quiet' ? 'quiet' : 'social';
      console.log(`🔊 Checking noise level: ${noiseLevel} against allowed:`, config.criteria.noiseLevel);
      if (!config.criteria.noiseLevel.includes(noiseLevel)) {
        console.log(`❌ Noise level ${noiseLevel} not allowed for ${recordType}`);
        return false;
      }
      console.log(`✅ Noise level ${noiseLevel} matches criteria`);
    }
    
    console.log(`🎉 Seat ${seat.id} PASSES all criteria for ${recordType}`);
    return true;
  };

  // Salesforce-style Record Type filtering
  const filterRecordsByType = (seats: LocalSeat[]): LocalSeat[] => {
    console.log('🏷️ Starting Record Type filtering...');
    console.log('Selected Record Types:', selectedRecordTypes);
    console.log('Total seats to filter:', seats.length);
    
    if (selectedRecordTypes.length === 0) {
      console.log('⚠️ No record types selected, returning all seats');
      return seats;
    }
    
    const filtered = seats.filter(seat => {
      console.log(`\n--- Checking seat ${seat.id} ---`);
      
      const matchesAnyType = selectedRecordTypes.some(recordType => {
        console.log(`Testing against ${recordType}...`);
        const matches = matchesRecordTypeCriteria(seat, recordType);
        console.log(`Result for ${recordType}:`, matches ? '✅ MATCH' : '❌ NO MATCH');
        return matches;
      });
      
      console.log(`Final result for seat ${seat.id}:`, matchesAnyType ? '🎯 INCLUDED' : '🚫 EXCLUDED');
      return matchesAnyType;
    });
    
    console.log(`\n📊 Record Type filtering results: ${filtered.length}/${seats.length} seats passed`);
    return filtered;
  };

  // Salesforce-style Priority Preference filtering
  const filterRecordsByPriority = (seats: LocalSeat[]): LocalSeat[] => {
    console.log('🎯 Starting Priority Preference filtering...');
    console.log('Priority Preference:', priorityPreference);
    console.log('Input seats:', seats.length);
    
    if (priorityPreference === 'all') {
      console.log('✅ Priority = "all", returning all seats');
      return seats;
    }
    
    if (priorityPreference === 'high_only') {
      // Only show high priority seats (score >= threshold)
      const threshold = 25; // Adjustable threshold
      console.log(`🔍 Filtering for high priority only (score >= ${threshold})`);
      
      const filtered = seats.filter(seat => {
        const score = getPriorityScore(seat);
        const passes = score >= threshold;
        console.log(`Seat ${seat.id}: score=${score}, passes=${passes}`);
        return passes;
      });
      
      console.log(`📊 Priority filtering results: ${filtered.length}/${seats.length} seats are high priority`);
      return filtered;
    }
    
    console.log('⚠️ Unknown priority preference, returning all seats');
    return seats;
  };
  const allPrices = Object.values(coachSeats).flat().map(s => s.price).filter(Boolean);
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : 100000;
  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 2000000;
  // Khởi tạo giá trị filter dựa trên dữ liệu thực tế
  useEffect(() => {
    if (allPrices.length > 0) {
      const realMinPrice = Math.min(...allPrices);
      const realMaxPrice = Math.max(...allPrices);
      setFilterMinPrice(realMinPrice);
      setFilterMaxPrice(realMaxPrice);
    }
  }, [allPrices]);
  
  // Debounced filter update khi user kéo slider
  const handlePriceRangeChange = (value: number | number[]) => {
    if (Array.isArray(value) && value.length === 2) {
      const [min, max] = value;
      
      // Validate: min_price <= max_price
      if (min <= max) {
        setFilterMinPrice(min);
        setFilterMaxPrice(max);
        
        // Clear existing timer
        if (filterDebounceTimer) {
          clearTimeout(filterDebounceTimer);
        }
        
        // Set new debounced timer (300ms) - chỉ khi filter đang active
        if (isFilterActive) {
          const timer = setTimeout(() => {
            triggerFilterUpdate(min, max, behavior, seatTypeFilters);
          }, 300);
          
          setFilterDebounceTimer(timer);
        }
      }
    }
  };
  
  // Real-time update histogram khi kéo slider (không debounce)
  const handleSliderChange = (value: number | number[]) => {
    if (Array.isArray(value) && value.length === 2) {
      const [min, max] = value;
      if (min <= max) {
        setFilterMinPrice(min);
        setFilterMaxPrice(max);
        // Histogram sẽ tự động update vì bins tính toán dựa trên filterMinPrice, filterMaxPrice
      }
    }
  };
  
  // Salesforce-style trigger filter update function
  const triggerFilterUpdate = (minPrice: number, maxPrice: number, behaviorFilter: typeof behavior, seatTypes: typeof seatTypeFilters) => {
    if (!isFilterActive) return;
    
    console.log('Salesforce-style auto-filtering with:', {
      recordTypes: selectedRecordTypes,
      priorityPreference,
      priceRange: [minPrice, maxPrice],
      behavior: behaviorFilter,
      seatTypes
    });
    
    applyFilters(minPrice, maxPrice, behaviorFilter, seatTypes);
  };

  // Histogram cho biểu đồ cột mật độ giá
  const BIN_COUNT = 20;
  const binWidth = maxPrice > minPrice ? (maxPrice - minPrice) / BIN_COUNT : 1;
  const bins = Array(BIN_COUNT).fill(0);
  allPrices.forEach(price => {
    const idx = Math.min(
      BIN_COUNT - 1,
      Math.floor((price - minPrice) / binWidth)
    );
    bins[idx]++;
  });
  const maxBin = Math.max(...bins, 1);

  // Salesforce-style filter application function
  const applyFilters = (minPrice: number, maxPrice: number, behaviorFilter: typeof behavior, seatTypes: typeof seatTypeFilters) => {
    console.log('\n🚀 ===== STARTING SALESFORCE-STYLE FILTERING =====');
    console.log('Filter parameters:', {
      selectedRecordTypes,
      priorityPreference,
      priceRange: [minPrice, maxPrice],
      behavior: behaviorFilter,
      seatTypes
    });

    let allFilteredSeats: any[] = [];
    let bestCoachInfo: { id: number | null; seats: LocalSeat[]; seatCount: number; avgScore: number } = { id: null, seats: [], seatCount: 0, avgScore: 0 };

    // Lặp qua TẤT CẢ các toa để tìm ghế tốt nhất
    Object.keys(coachSeats).forEach(coachIdStr => {
      const coachId = Number(coachIdStr);
      const currentCoachSeats = coachSeats[coachId] || [];
      
      if (currentCoachSeats.length === 0) return;

      console.log(`\n📍 Checking Coach ${coachId} with ${currentCoachSeats.length} total seats`);
      
      // Step 1: Apply Record Type filtering (Salesforce-style)
      console.log(`\n📋 STEP 1: Record Type Filtering for Coach ${coachId}`);
      let filtered = filterRecordsByType(currentCoachSeats);
      console.log(`After Record Type filtering: ${filtered.length} seats remain in Coach ${coachId}`);
      
      if (filtered.length === 0) return;
      
      // Step 2: Apply Priority Preference filtering
      console.log(`\n🎯 STEP 2: Priority Preference Filtering for Coach ${coachId}`);
      filtered = filterRecordsByPriority(filtered);
      console.log(`After Priority filtering: ${filtered.length} seats remain in Coach ${coachId}`);
      
      if (filtered.length === 0) return;
      
      // Step 3: Apply price range filtering
      console.log(`\n💰 STEP 3: Price Range Filtering for Coach ${coachId}`);
      const beforePriceCount = filtered.length;
      filtered = filtered.filter(seat => {
        const inRange = seat.price >= minPrice && seat.price <= maxPrice;
        return inRange;
      });
      console.log(`After Price filtering: ${filtered.length}/${beforePriceCount} seats remain in Coach ${coachId}`);
      
      if (filtered.length === 0) return;
      
      // Step 4: Apply behavior filtering (if specified)
      if (behaviorFilter) {
        console.log(`\n🔊 STEP 4: Behavior Filtering for Coach ${coachId}`);
        const beforeBehaviorCount = filtered.length;
        filtered = filtered.filter(seat => {
          if (behaviorFilter === 'quiet') {
            return seat.behavior === 'quiet';
          } else if (behaviorFilter === 'noise') {
            return seat.behavior === 'social';
          }
          return true;
        });
        console.log(`After Behavior filtering: ${filtered.length}/${beforeBehaviorCount} seats remain in Coach ${coachId}`);
      }
      
      // Step 5: Legacy seat type filtering (for backward compatibility)
      console.log(`\n🪑 STEP 5: Legacy Seat Type Filtering for Coach ${coachId}`);
      if (!seatTypes.seat || !seatTypes.compartment_4 || !seatTypes.compartment_6) {
        const beforeLegacyCount = filtered.length;
        filtered = filtered.filter(seat => {
          let seatTypeMatch = false;
          if (seatTypes.seat && seat.id.includes('-ngoi-')) {
            seatTypeMatch = true;
          }
          if (seatTypes.compartment_4 && seat.id.includes('-k4-')) {
            seatTypeMatch = true;
          }
          if (seatTypes.compartment_6 && seat.id.includes('-k6-')) {
            seatTypeMatch = true;
          }
          return seatTypeMatch;
        });
        console.log(`After Legacy filtering: ${filtered.length}/${beforeLegacyCount} seats remain in Coach ${coachId}`);
      }
      
      // Step 6: Only show available seats
      console.log(`\n✅ STEP 6: Availability Filtering for Coach ${coachId}`);
      const beforeAvailabilityCount = filtered.length;
      filtered = filtered.filter(seat => {
        const isAvailable = seat.status === 'available';
        if (!isAvailable) {
          console.log(`Seat ${seat.id}: status is ${seat.status}, not available`);
        }
        return isAvailable;
      });
      console.log(`After Availability filtering: ${filtered.length}/${beforeAvailabilityCount} seats remain in Coach ${coachId}`);
      
      if (filtered.length === 0) return;
      
      // Sort by priority score (highest first)
      console.log(`\n📊 STEP 7: Priority Sorting for Coach ${coachId}`);
      filtered.sort((a, b) => {
        const scoreA = getPriorityScore(a);
        const scoreB = getPriorityScore(b);
        return scoreB - scoreA;
      });
      
      // Tính điểm trung bình của toa
      const avgScore = filtered.reduce((sum, seat) => sum + getPriorityScore(seat), 0) / filtered.length;
      
      // Thêm ghế vào danh sách tổng
      allFilteredSeats.push(...filtered.map(seat => ({ ...seat, coachId })));
      
      // Kiểm tra xem đây có phải toa tốt nhất không
      if (filtered.length > bestCoachInfo.seatCount || 
          (filtered.length === bestCoachInfo.seatCount && avgScore > bestCoachInfo.avgScore)) {
        bestCoachInfo = {
          id: coachId,
          seats: filtered,
          seatCount: filtered.length,
          avgScore: avgScore
        };
      }
      
      console.log(`🎉 Coach ${coachId} final results: ${filtered.length} seats, avg score: ${avgScore.toFixed(1)}`);
    });

    // Sắp xếp tất cả ghế theo priority score
    allFilteredSeats.sort((a, b) => getPriorityScore(b) - getPriorityScore(a));
    
    setFilteredSeatIds(allFilteredSeats.map(seat => seat.id));
    
    console.log('\n🎉 ===== FILTERING COMPLETE =====');
    console.log(`Total results: ${allFilteredSeats.length} seats match all criteria across all coaches`);
    console.log(`Best coach: ${bestCoachInfo.id} with ${bestCoachInfo.seatCount} seats`);
    
    if (allFilteredSeats.length > 0 && bestCoachInfo.id) {
      // TỰ ĐỘNG CHUYỂN ĐẾN TOA TỐT NHẤT
      const currentCoachId = COACHES[selectedCoachIdx].id;
      if (bestCoachInfo.id !== currentCoachId) {
        console.log(`🚂 Auto-switching from Coach ${currentCoachId} to Coach ${bestCoachInfo.id}`);
        
        // Tìm index của coach tốt nhất
        const bestCoachIndex = COACHES.findIndex(coach => coach.id === bestCoachInfo.id);
        if (bestCoachIndex !== -1) {
          setSelectedCoachIdx(bestCoachIndex);
          
          // Hiển thị thông báo - bỏ alert khi kéo slider
          // alert(`🎯 Tìm thấy ${allFilteredSeats.length} ghế phù hợp! Đã chuyển đến Toa ${bestCoachInfo.id} có ${bestCoachInfo.seatCount} ghế tốt nhất.`);
        }
      } else {
        // alert(`🎯 Tìm thấy ${allFilteredSeats.length} ghế phù hợp trong toa hiện tại!`);
      }
      
      // Display results with Salesforce-style messaging
      const message = `✅ Found ${allFilteredSeats.length} records matching criteria across all coaches`;
      showToast(message, '#4caf50');
    } else {
      // Không tìm thấy ghế nào
      const message = `❌ No records found. Try adjusting Record Types or Priority Preferences.`;
      showToast(message, '#f44336');
      // alert('❌ Không tìm thấy ghế nào phù hợp với tiêu chí lọc trong toàn bộ tàu.');
    }
    
    console.log('Filter summary:', {
      recordTypes: selectedRecordTypes,
      priorityPreference,
      priceRange: [minPrice, maxPrice],
      behavior: behaviorFilter,
      seatTypes,
      matchedSeats: allFilteredSeats.length,
      bestCoach: bestCoachInfo.id
    });
    
    return allFilteredSeats.length;
  };

  // Salesforce-style filter handler function
  const handleFilterSeats = () => {
    console.log('🚨🚨🚨 FILTER BUTTON CLICKED! 🚨🚨🚨');
    
    console.log('=== SALESFORCE-STYLE RECORD FILTER CLICKED ===');
    console.log('Current filter settings:', {
      recordTypes: selectedRecordTypes,
      priorityPreference,
      priceRange: [filterMinPrice, filterMaxPrice],
      behavior,
      seatTypeFilters
    });
    
    console.log('🔍 Available coach seats:', coachSeats);
    console.log('🎯 Selected coach index:', selectedCoachIdx);
    console.log('🏠 Current coach data:', COACHES[selectedCoachIdx]);
    
    // Validate Record Types selection
    if (selectedRecordTypes.length === 0) {
      console.log('⚠️ ERROR: No Record Types selected!');
      showToast('⚠️ Please select at least one Record Type', '#ff9800');
      return;
    }
    
    console.log('✅ Record Types validation passed');
    
    // Activate filter
    setIsFilterActive(true);
    console.log('🔥 Filter activated, calling applyFilters...');
    
    // Apply Salesforce-style filtering
    const matchCount = applyFilters(filterMinPrice, filterMaxPrice, behavior, seatTypeFilters);
    
    // Log results with Salesforce-style terminology
    console.log(`🎉 Salesforce-style Record Filter applied successfully. Found ${matchCount} matching records.`);
    
    // Show popup instead of alert
    setFilterResultMessage(`Filter complete! Found ${matchCount} matching records.`);
    setShowFilterResult(true);
  };
  
  // Salesforce-style reset filter function
  const handleResetFilter = () => {
    // Reset price range to default values
    if (allPrices.length > 0) {
      setFilterMinPrice(Math.min(...allPrices));
      setFilterMaxPrice(Math.max(...allPrices));
    }
    
    // Reset Salesforce-style filters
    setSelectedRecordTypes(['standard', 'medium_priority', 'high_priority']);
    setPriorityPreference('all');
    
    // Reset legacy filters for backward compatibility
    setBehavior(null);
    setSeatTypeFilters({
      seat: true,
      compartment_4: true,
      compartment_6: true
    });
    setSeatType('seat');
    
    // Reset filter state
    setIsFilterActive(false);
    setFilteredSeatIds([]);
    
    // Clear debounce timer
    if (filterDebounceTimer) {
      clearTimeout(filterDebounceTimer);
      setFilterDebounceTimer(null);
    }
    
    showToast('🔄 All Record Types and Preferences reset successfully', '#2196f3');
  };
  
  // Hàm hiển thị toast
  const showToast = (message: string, color: string) => {
    const toastDiv = document.createElement('div');
    toastDiv.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${color};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideDown 0.3s ease;
    `;
    toastDiv.textContent = message;
    document.body.appendChild(toastDiv);
    
    setTimeout(() => {
      if (document.body.contains(toastDiv)) {
        document.body.removeChild(toastDiv);
      }
    }, 3000);
  };

  // Đảm bảo chỉ có 1 khai báo:
  const [showBehaviorInfo, setShowBehaviorInfo] = useState(false);
  
  // State cho filter result popup
  const [showFilterResult, setShowFilterResult] = useState(false);
  const [filterResultMessage, setFilterResultMessage] = useState('');

  // Hàm lọc ghế tổng hợp
  function filterSeats(seats: LocalSeat[]) {
    return seats.filter(seat => {
      // Lọc theo giá
      if (seat.price < filterMinPrice || seat.price > filterMaxPrice) return false;
      // Logic đặc biệt theo yêu cầu:
      if (behavior === 'quiet' && seatType === 'seat') {
        // Chỉ cho phép toa 2
        if (selectedCoachIdx !== COACHES.findIndex(c => c.id === 2)) return false;
      }
      if (behavior === 'noise' && seatType === 'seat') {
        // Chỉ cho phép toa 1
        if (selectedCoachIdx !== COACHES.findIndex(c => c.id === 1)) return false;
      }
      if (behavior === 'quiet' && seatType === 'k4') {
        // Chỉ cho phép toa 10
        if (selectedCoachIdx !== COACHES.findIndex(c => c.id === 10)) return false;
      }
      if (behavior === 'noise' && seatType === 'k4') {
        // Chỉ cho phép toa 6
        if (selectedCoachIdx !== COACHES.findIndex(c => c.id === 6)) return false;
      }
      if (behavior === 'quiet' && seatType === 'k6') {
        // Chỉ cho phép toa 5
        if (selectedCoachIdx !== COACHES.findIndex(c => c.id === 5)) return false;
      }
      if (behavior === 'noise' && seatType === 'k6') {
        // Chỉ cho phép toa 3
        if (selectedCoachIdx !== COACHES.findIndex(c => c.id === 3)) return false;
      }
      // Lọc theo loại ghế/giường
      if (seatType === 'seat' && !(seat.floor === 1 && seat.behavior)) return false;
      if (seatType === 'k4' && !(seat.floor === 2 || seat.floor === 1 && seat.behavior)) return false;
      if (seatType === 'k6' && !(seat.floor === 3 || seat.floor === 2)) return false;
      // Lọc theo hành vi
      if (behavior && seat.behavior !== behavior) return false;
      // ... các filter khác nếu có
      return true;
    });
  }

  // State cho popup cảnh báo chọn ghế gần nhà vệ sinh
  const [showWcSuggest, setShowWcSuggest] = useState(false);

  // Khi trang load, nếu có trẻ em hoặc người cao tuổi thì hiện popup
  useEffect(() => {
    if ((passenger.child > 0 || passenger.elderly > 0)) {
      setShowWcSuggest(true);
    }
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: sliderStyles }} />
      <div style={{ maxWidth: 480, margin: '0 auto', background: '#f7f7fa', minHeight: '100vh', paddingBottom: 80 }}>
      {/* Header + Stepper */}
      <div style={{ background: '#1976d2', color: '#fff', padding: 16, borderRadius: '0 0 16px 16px', marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{from} → {to}</div>
        <div style={{ fontSize: 14, margin: '2px 0 6px 0' }}>{departDate} • {totalPassengers} passenger(s)</div>
        <div style={{ display: 'flex', gap: 8, fontSize: 13, marginTop: 2 }}>
          <span style={{ fontWeight: 700, color: '#fff', background: '#1565c0', borderRadius: 8, padding: '2px 8px' }}>1 Select seat</span>
          <span style={{ color: '#bbdefb' }}>→</span>
          <span style={{ color: '#bbdefb' }}>2 Enter info</span>
          <span style={{ color: '#bbdefb' }}>→</span>
          <span style={{ color: '#bbdefb' }}>3 Payment</span>
        </div>
      </div>
      {/* Swiper chọn khoang */}
      <div style={{ margin: '8px 0 8px 0', background: '#f5f6fa', borderRadius: 12, padding: '8px 0' }}>
        <Swiper
          slidesPerView={3.2}
          spaceBetween={0}
          style={{ padding: '0 0 8px 0', minHeight: 70 }}
          // Không dùng navigation, pagination
        >
          {/* Đầu tàu SVG */}
          <SwiperSlide key="train-head" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: 48, minWidth: 48, maxWidth: 48, padding: 0, margin: 0, marginLeft: 4 }}>
            <svg width="48" height="48" viewBox="0 0 48 40">
              <path d="M0,40 Q0,0 34,0 H48 V40 Z" fill="#ccc"/>
              <text x="50%" y="65%" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="13" fontFamily="inherit">{trainName}</text>
            </svg>
          </SwiperSlide>
          {COACHES.map((coach, idx) => (
            <SwiperSlide key={coach.id} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginLeft: idx === 0 ? 0 : -10 }}>
              <div
                onClick={() => setSelectedCoachIdx(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: '#fff',
                  border: idx === selectedCoachIdx ? '2px solid #1976d2' : '2px solid #e0e0e0',
                  borderRadius: 12,
                  boxShadow: 'none',
                  cursor: 'pointer',
                  minWidth: 120,
                  maxWidth: 150,
                  padding: '4px 8px',
                  transition: 'all 0.2s',
                  position: 'relative',
                  fontWeight: 600,
                  height: 48
                }}
              >
                {/* Số thứ tự khoang */}
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: idx === selectedCoachIdx ? '#1976d2' : '#e0e0e0',
                  color: idx === selectedCoachIdx ? '#fff' : '#888',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 12, flexShrink: 0,
                  marginRight: 4
                }}>{idx + 1}</div>
                {/* Thông tin khoang */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: idx === selectedCoachIdx ? '#1976d2' : '#222', marginBottom: 1 }}>{coach.type}</div>
                  <div style={{ fontSize: 10, color: '#888', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {coach.seats} seats <span style={{ fontSize: 13, lineHeight: 1 }}>•</span> From {Math.round(coach.price/1000)}K
                  </div>
                </div>
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
      {/* Thông tin toa */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 8, boxShadow: '0 1px 4px #0001' }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Coach {COACHES[selectedCoachIdx].id}: {COACHES[selectedCoachIdx].type}</div>
        <div style={{ fontSize: 13, color: '#666', margin: '4px 0 8px 0' }}>Displayed price is for 1 adult.</div>
        {/* Seat status legend */}
        <div style={{ display: 'flex', gap: 16, fontSize: 14, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={false} readOnly style={{ accentColor: '#10b981' }} /> Available
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={true} readOnly style={{ accentColor: '#4caf50' }} /> Selected
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={true} disabled readOnly style={{ accentColor: '#bdbdbd' }} /> Sold
          </div>
          {isFilterActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ 
                width: 16, 
                height: 16, 
                background: '#ff9800', 
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700
              }}>★</div>
              <span>Record Match</span>
            </div>
          )}
        </div>
      </div>
      {/* Sơ đồ ghế */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, minHeight: 320, boxShadow: '0 1px 4px #0001' }}>
        {renderCoachSeats(COACHES[selectedCoachIdx])}
      </div>
      {/* Thông tin chọn ghế */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 8, boxShadow: '0 1px 4px #0001' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#222' }}>Seat Selection</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Nút Auto Select */}
            <button
              onClick={autoSelectSeats}
              disabled={selectedSeatIds.length === totalPassengers}
              style={{
                background: selectedSeatIds.length === totalPassengers ? '#f5f5f5' : '#1976d2',
                color: selectedSeatIds.length === totalPassengers ? '#999' : '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: selectedSeatIds.length === totalPassengers ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s'
              }}
            >
              🎯 Auto Select
            </button>
            
            {selectedSeatIds.length > 0 && (
              <button
                onClick={() => setSelectedSeatIds([])}
                style={{
                  background: '#f5f5f5',
                  color: '#666',
                  border: 'none',
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Clear All
              </button>
            )}
            <div style={{ 
              fontSize: 14, 
              fontWeight: 600,
              color: selectedSeatIds.length === totalPassengers ? '#4caf50' : selectedSeatIds.length > 0 ? '#ff9800' : '#666',
              background: selectedSeatIds.length === totalPassengers ? '#e8f5e8' : selectedSeatIds.length > 0 ? '#fff3e0' : '#f5f5f5',
              padding: '4px 12px',
              borderRadius: 8
            }}>
              {selectedSeatIds.length}/{totalPassengers} seats
            </div>
          </div>
        </div>
        
        {/* Hiển thị danh sách hành khách */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>Passengers: {getPassengerDescription()}</div>
          
          {/* Mô tả chiến lược Auto Select */}
          {selectedSeatIds.length === 0 && (
            <div style={{ 
              background: '#f0f8ff', 
              color: '#1976d2', 
              padding: '10px', 
              borderRadius: 6, 
              fontSize: 13,
              marginBottom: 8,
              border: '1px solid #e3f2fd'
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>🎯 Auto Select Strategy:</div>
              <div>
                {passenger.child > 0 || passenger.elderly > 0 
                  ? "Will select seats near toilet for children/elderly comfort"
                  : totalPassengers === 3
                  ? "Will find 4-bed compartment for your group of 3"
                  : totalPassengers === 4
                  ? "Will find 4-bed compartment for your group"
                  : totalPassengers === 5
                  ? "Will find 6-bed compartment for your group of 5"
                  : totalPassengers === 6
                  ? "Will find 6-bed compartment for your group"
                  : totalPassengers === 7
                  ? "Will find 6-bed compartment + 1 adjacent seat for your group of 7"
                  : "Will select seats in same coach when possible"
                }
              </div>
            </div>
          )}
          
          {/* Hiển thị ghế đã chọn */}
          {selectedSeatIds.length > 0 && (
            <div style={{ fontSize: 14, color: '#1976d2', marginBottom: 8 }}>
              Selected seats: {selectedSeatIds.map(seatId => seatId.split('-').pop()).join(', ')}
            </div>
          )}
          
          {/* Hiển thị thông báo Auto Select */}
          {autoSelectMessage && (
            <div style={{ 
              fontSize: 14, 
              color: autoSelectMessage.startsWith('❌') ? '#d32f2f' : '#1976d2',
              background: autoSelectMessage.startsWith('❌') ? '#ffebee' : '#e3f2fd',
              padding: '8px 12px',
              borderRadius: 6,
              marginBottom: 8,
              border: `1px solid ${autoSelectMessage.startsWith('❌') ? '#ffcdd2' : '#bbdefb'}`
            }}>
              {autoSelectMessage}
            </div>
          )}
        </div>

        {/* Thông báo trạng thái */}
        {selectedSeatIds.length === 0 && (
          <div style={{ 
            background: '#e3f2fd', 
            color: '#1976d2', 
            padding: '12px', 
            borderRadius: 8, 
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span style={{ fontSize: 16 }}>👆</span>
            Please select {totalPassengers} seat{totalPassengers > 1 ? 's' : ''} for your passenger{totalPassengers > 1 ? 's' : ''}
          </div>
        )}
        
        {selectedSeatIds.length > 0 && selectedSeatIds.length < totalPassengers && (
          <div style={{ 
            background: '#fff3e0', 
            color: '#f57c00', 
            padding: '12px', 
            borderRadius: 8, 
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            You need to select {totalPassengers - selectedSeatIds.length} more seat{totalPassengers - selectedSeatIds.length > 1 ? 's' : ''}
          </div>
        )}
        
        {selectedSeatIds.length === totalPassengers && (
          <div style={{ 
            background: '#e8f5e8', 
            color: '#4caf50', 
            padding: '12px', 
            borderRadius: 8, 
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span style={{ fontSize: 16 }}>✅</span>
            Perfect! You have selected all required seats. Click Continue to proceed.
          </div>
        )}

        {/* Gợi ý cho trẻ em và người già */}
        {(passenger.child > 0 || passenger.elderly > 0) && selectedSeatIds.length === 0 && (
          <div style={{ 
            background: '#fff3e0', 
            color: '#f57c00', 
            padding: '12px', 
            borderRadius: 8, 
            fontSize: 14,
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span style={{ fontSize: 16 }}>�👴</span>
            <span>
              You should select a seat near the toilet because your group includes elderly or children.
            </span>
          </div>
        )}
      </div>
      {/* Tổng tiền + nút tiếp tục */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 4px #0001', position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
          <span>Total for {selectedSeatIds.length}/{totalPassengers} passenger(s)</span>
          <span style={{ color: '#e53935', fontWeight: 700, fontSize: 18 }}>{selectedSeatIds.reduce((total, seatId) => {
            const seat = Object.values(coachSeats).flat().find(s => s.id === seatId);
            return total + (seat?.price || 0);
          }, 0).toLocaleString()}đ</span>
        </div>
        
        {/* Thông báo trạng thái trước nút */}
        {selectedSeatIds.length < totalPassengers && (
          <div style={{ 
            fontSize: 14, 
            color: '#666', 
            textAlign: 'center', 
            marginBottom: 8,
            padding: '8px 12px',
            background: '#f5f5f5',
            borderRadius: 6
          }}>
            Please select {totalPassengers - selectedSeatIds.length} more seat{totalPassengers - selectedSeatIds.length > 1 ? 's' : ''} to continue
          </div>
        )}
        
        <button
          onClick={handleProceedToPassengerInfo}
          disabled={selectedSeatIds.length < totalPassengers}
          style={{ 
            width: '100%', 
            background: selectedSeatIds.length < totalPassengers ? '#e0e0e0' : '#0d47a1', 
            color: selectedSeatIds.length < totalPassengers ? '#888' : '#fff', 
            fontWeight: 700, 
            fontSize: 18, 
            borderRadius: 8, 
            padding: '14px 0', 
            border: 'none', 
            boxShadow: selectedSeatIds.length < totalPassengers ? 'none' : '0 2px 8px #0001', 
            cursor: selectedSeatIds.length < totalPassengers ? 'not-allowed' : 'pointer', 
            opacity: selectedSeatIds.length < totalPassengers ? 0.6 : 1,
            transition: 'all 0.3s ease'
          }}
        >
          {selectedSeatIds.length < totalPassengers 
            ? `Select ${totalPassengers - selectedSeatIds.length} more seat${totalPassengers - selectedSeatIds.length > 1 ? 's' : ''}` 
            : 'Continue'
          }
        </button>
      </div>

      {/* Dialog thông tin hành vi */}
      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Behavior information</DialogTitle>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600, color: '#1f2937' }}>Quiet Zone</h4>
              <p style={{ margin: 0, fontSize: 14, color: '#6b7280', lineHeight: 1.5 }}>
                Quiet area, suitable for those who want to rest, read, or work.
              </p>
            </div>
            <div>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 600, color: '#1f2937' }}>Social Zone</h4>
              <p style={{ margin: 0, fontSize: 14, color: '#6b7280', lineHeight: 1.5 }}>
                Lively area, suitable for those who want to chat and connect with other passengers.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Chú thích noise */}
      <div style={{ fontSize: 12, color: '#888', margin: '4px 0 8px 0', textAlign: 'right' }}>
        Color indicates noise level on the train
      </div>

      {/* BỘ LỌC (COPY TỪ SearchResults) */}
      <div style={{ background: '#fff', margin: '16px auto 0 auto', width: '100%', maxWidth: 420, borderRadius: 12, padding: 16, boxShadow: '0 2px 8px #e0e0e0', marginBottom: 140 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1976d2' }}>Salesforce-Style Record Filter</div>
          {isFilterActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#ff9800', fontWeight: 600, background: '#fff8e1', padding: '2px 6px', borderRadius: 4 }}>
                {filteredSeatIds.length} records
              </span>
              <button 
                onClick={handleResetFilter}
                style={{ 
                  background: '#f5f5f5', 
                  color: '#666', 
                  border: 'none', 
                  borderRadius: 6, 
                  padding: '4px 8px', 
                  fontSize: 12, 
                  fontWeight: 600, 
                  cursor: 'pointer' 
                }}
              >
                Reset
              </button>
            </div>
          )}
        </div>
        {/* Price range with histogram and rc-slider */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Price range</div>
          <div style={{ color: '#888', fontSize: 13, marginBottom: 18 }}>Trip price, includes all fees</div>
          {allPrices.length > 0 ? (
            <>
              {/* Histogram */}
              <div style={{ display: 'flex', alignItems: 'flex-end', height: 48, margin: '0 0 0 0', width: '100%', background: 'none', padding: 0 }}>
                {bins.map((count, i) => {
                  const binStart = minPrice + i * binWidth;
                  const binEnd = minPrice + (i + 1) * binWidth;
                  const isActive = binEnd > filterMinPrice && binStart < filterMaxPrice;
                  return (
                    <div
                      key={i}
                      style={{
                        width: `calc(${100 / BIN_COUNT}% - 2px)` ,
                        height: `${(count / maxBin) * 40 || 2}px`,
                        background: isActive ? '#ec407a' : '#e0e0e0',
                        margin: '0 1px',
                        borderRadius: 8,
                        transition: 'height 0.2s, background 0.2s',
                        opacity: count > 0 ? 1 : 0.2,
                        boxShadow: isActive ? '0 2px 8px #ec407a22' : 'none',
                        position: 'relative',
                      }}
                      title={`Price: ${Math.round(minPrice + i * binWidth).toLocaleString()}đ - ${Math.round(minPrice + (i + 1) * binWidth).toLocaleString()}đ\nSeats: ${count}`}
                    />
                  );
                })}
              </div>
              {/* Smooth Dual Range Slider */}
              <div 
                className="dual-range-container"
                style={{ 
                  position: 'relative', 
                  width: '100%', 
                  margin: '12px 0', 
                  padding: '16px 8px', 
                  background: 'none', 
                  height: 60,
                  overflow: 'visible'
                }}
              >
                {/* Track background */}
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: 8,
                  right: 8,
                  height: 8,
                  background: '#f3f3f3',
                  borderRadius: 4,
                  transform: 'translateY(-50%)'
                }} />
                
                {/* Active track */}
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: `${8 + ((filterMinPrice - minPrice) / (maxPrice - minPrice)) * (100 - 16)}%`,
                  width: `${((filterMaxPrice - filterMinPrice) / (maxPrice - minPrice)) * (100 - 16)}%`,
                  height: 8,
                  background: '#ec407a',
                  borderRadius: 4,
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  transition: 'all 0.1s ease-out'
                }} />
                
                {/* Min Range Input */}
                <input
                  type="range"
                  min={minPrice}
                  max={maxPrice}
                  step={2500}
                  value={filterMinPrice}
                  onInput={(e) => {
                    const newMin = parseInt((e.target as HTMLInputElement).value);
                    if (newMin <= filterMaxPrice) {
                      setFilterMinPrice(newMin);
                    }
                  }}
                  onChange={(e) => {
                    const newMin = parseInt((e.target as HTMLInputElement).value);
                    if (newMin <= filterMaxPrice) {
                      setFilterMinPrice(newMin);
                    }
                  }}
                  onMouseUp={(e) => {
                    const newMin = parseInt((e.target as HTMLInputElement).value);
                    if (isFilterActive) {
                      handlePriceRangeChange([newMin, filterMaxPrice]);
                    }
                  }}
                  onTouchEnd={(e) => {
                    const newMin = parseInt((e.target as HTMLInputElement).value);
                    if (isFilterActive) {
                      handlePriceRangeChange([newMin, filterMaxPrice]);
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    WebkitAppearance: 'none',
                    appearance: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    outline: 'none',
                    zIndex: 1,
                    margin: 0,
                    padding: 0
                  }}
                />
                
                {/* Max Range Input */}
                <input
                  type="range"
                  min={minPrice}
                  max={maxPrice}
                  step={2500}
                  value={filterMaxPrice}
                  onInput={(e) => {
                    const newMax = parseInt((e.target as HTMLInputElement).value);
                    if (newMax >= filterMinPrice) {
                      setFilterMaxPrice(newMax);
                    }
                  }}
                  onChange={(e) => {
                    const newMax = parseInt((e.target as HTMLInputElement).value);
                    if (newMax >= filterMinPrice) {
                      setFilterMaxPrice(newMax);
                    }
                  }}
                  onMouseUp={(e) => {
                    const newMax = parseInt((e.target as HTMLInputElement).value);
                    if (isFilterActive) {
                      handlePriceRangeChange([filterMinPrice, newMax]);
                    }
                  }}
                  onTouchEnd={(e) => {
                    const newMax = parseInt((e.target as HTMLInputElement).value);
                    if (isFilterActive) {
                      handlePriceRangeChange([filterMinPrice, newMax]);
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    WebkitAppearance: 'none',
                    appearance: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    outline: 'none',
                    zIndex: 2,
                    margin: 0,
                    padding: 0
                  }}
                />
                
                {/* Min handle */}
                <div 
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: `${8 + ((filterMinPrice - minPrice) / (maxPrice - minPrice)) * (100 - 16)}%`,
                    width: 24,
                    height: 24,
                    background: '#fff',
                    border: '3px solid #ec407a',
                    borderRadius: '50%',
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 2px 8px rgba(236, 64, 122, 0.3)',
                    pointerEvents: 'none',
                    zIndex: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 7,
                    fontWeight: 700,
                    color: '#ec407a',
                    transition: 'left 0.1s ease-out'
                  }}
                >
                  MIN
                </div>
                
                {/* Max handle */}
                <div 
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: `${8 + ((filterMaxPrice - minPrice) / (maxPrice - minPrice)) * (100 - 16)}%`,
                    width: 24,
                    height: 24,
                    background: '#fff',
                    border: '3px solid #ec407a',
                    borderRadius: '50%',
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 2px 8px rgba(236, 64, 122, 0.3)',
                    pointerEvents: 'none',
                    zIndex: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 7,
                    fontWeight: 700,
                    color: '#ec407a',
                    transition: 'left 0.1s ease-out'
                  }}
                >
                  MAX
                </div>
              </div>

              {/* Min/max price and label */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8 }}>
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ color: '#888', fontWeight: 500, fontSize: 15, marginBottom: 2 }}>Minimum</div>
                  <div style={{ color: '#222', fontWeight: 700, fontSize: 22, letterSpacing: 0.5 }}>đ{filterMinPrice.toLocaleString()}</div>
                </div>
                <div style={{ width: 32 }} />
                <div style={{ textAlign: 'center', flex: 1 }}>
                  <div style={{ color: '#888', fontWeight: 500, fontSize: 15, marginBottom: 2 }}>Maximum</div>
                  <div style={{ color: '#222', fontWeight: 700, fontSize: 22, letterSpacing: 0.5 }}>đ{filterMaxPrice.toLocaleString()}</div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ color: '#e53935', fontWeight: 600, fontSize: 15, margin: '12px 0' }}>
              No price data to filter
            </div>
          )}
        </div>
        {/* Salesforce-style Record Types */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, display: 'block', color: '#1976d2' }}>Record Types</label>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Select seat categories to filter by</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(recordTypeConfig).map(([key, config]) => (
              <label key={key} style={{ 
                display: 'flex', 
                alignItems: 'flex-start', 
                cursor: 'pointer', 
                fontSize: 14, 
                padding: 12,
                background: selectedRecordTypes.includes(key) ? '#e3f2fd' : '#f8f9fa',
                border: selectedRecordTypes.includes(key) ? '2px solid #1976d2' : '2px solid #e0e0e0',
                borderRadius: 8,
                transition: 'all 0.2s'
              }}>
                <input 
                  type="checkbox" 
                  checked={selectedRecordTypes.includes(key)} 
                  onChange={(e) => {
                    console.log(`🔘 Record Type checkbox clicked: ${key}, checked: ${e.target.checked}`);
                    if (e.target.checked) {
                      console.log(`✅ Adding Record Type: ${key}`);
                      setSelectedRecordTypes(prev => {
                        console.log(`Previous selected types:`, prev);
                        const newTypes = [...prev, key];
                        console.log(`New selected types:`, newTypes);
                        return newTypes;
                      });
                    } else {
                      console.log(`❌ Removing Record Type: ${key}`);
                      setSelectedRecordTypes(prev => {
                        console.log(`Previous selected types:`, prev);
                        const newTypes = prev.filter(rt => rt !== key);
                        console.log(`New selected types:`, newTypes);
                        return newTypes;
                      });
                    }
                  }}
                  style={{ marginRight: 12, marginTop: 2, flexShrink: 0 }} 
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#222', marginBottom: 4 }}>{config.label}</div>
                  <div style={{ fontSize: 12, color: '#666', lineHeight: 1.4 }}>{config.description}</div>
                  <div style={{ fontSize: 11, color: '#1976d2', marginTop: 4, fontWeight: 500 }}>
                    Coaches: {config.criteria.coachPosition.join(', ')} • Priority: {config.criteria.priorityScore}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Salesforce-style Priority Preferences */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, display: 'block', color: '#1976d2' }}>Priority Preferences</label>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Choose how to prioritize results</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer', 
              fontSize: 14,
              padding: 10,
              background: priorityPreference === 'all' ? '#e3f2fd' : '#f8f9fa',
              border: priorityPreference === 'all' ? '2px solid #1976d2' : '2px solid #e0e0e0',
              borderRadius: 8,
              transition: 'all 0.2s'
            }}>
              <input 
                type="radio" 
                name="priorityPreference" 
                checked={priorityPreference === 'all'} 
                onChange={() => {
                  console.log(`🔘 Priority Preference changed to: all`);
                  setPriorityPreference('all');
                }} 
                style={{ marginRight: 12 }} 
              />
              <div>
                <div style={{ fontWeight: 600, color: '#222' }}>Show All Records</div>
                <div style={{ fontSize: 12, color: '#666' }}>Display all matching seats, sorted by priority score</div>
              </div>
            </label>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              cursor: 'pointer', 
              fontSize: 14,
              padding: 10,
              background: priorityPreference === 'high_only' ? '#e3f2fd' : '#f8f9fa',
              border: priorityPreference === 'high_only' ? '2px solid #1976d2' : '2px solid #e0e0e0',
              borderRadius: 8,
              transition: 'all 0.2s'
            }}>
              <input 
                type="radio" 
                name="priorityPreference" 
                checked={priorityPreference === 'high_only'} 
                onChange={() => {
                  console.log(`🔘 Priority Preference changed to: high_only`);
                  setPriorityPreference('high_only');
                }} 
                style={{ marginRight: 12 }} 
              />
              <div>
                <div style={{ fontWeight: 600, color: '#222' }}>High Priority Only</div>
                <div style={{ fontSize: 12, color: '#666' }}>Show only premium seats with high priority scores</div>
              </div>
            </label>
          </div>
        </div>

        {/* Legacy Noise Level Filter */}
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', position: 'relative', fontSize: 14 }}>
          <label style={{ fontSize: 14, fontWeight: 600, marginRight: 8 }}>Noise Level:</label>
          <label style={{ display: 'inline-flex', alignItems: 'center', marginRight: 12, cursor: 'pointer', fontSize: 14 }}>
            <input type="radio" name="behavior" checked={behavior === 'quiet'} onChange={() => setBehavior('quiet')} style={{ marginRight: 4 }} />
            Quiet
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', marginRight: 12, cursor: 'pointer', fontSize: 14 }}>
            <input type="radio" name="behavior" checked={behavior === 'noise'} onChange={() => setBehavior('noise')} style={{ marginRight: 4 }} />
            Noise
          </label>
          <label style={{ display: 'none', alignItems: 'center', marginRight: 12, cursor: 'pointer', fontSize: 14 }}>
            <input type="radio" name="behavior" checked={behavior === null} onChange={() => setBehavior(null)} style={{ marginRight: 4 }} />
            Any
          </label>
          <span style={{ marginLeft: 8, color: '#888', fontSize: 14, cursor: 'pointer' }} onClick={() => setShowBehaviorInfo(true)}>ⓘ</span>
        </div>
        <div style={{ marginBottom: 12, marginTop: -8, fontSize: 14 }}>
          <span style={{ fontSize: 14, color: '#888' }}>Color: <span style={{ color: '#f87171', fontWeight: 600 }}>red</span> (noisy), <span style={{ color: '#10b981', fontWeight: 600 }}>green</span> (quiet)</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {/* Debug Test Button - ẨN */}
          <button 
            onClick={testFilterSystem}
            style={{ 
              display: 'none',
              background: '#ff9800', 
              color: '#fff', 
              border: 'none', 
              borderRadius: 8, 
              padding: '8px 16px', 
              fontWeight: 600, 
              fontSize: 12, 
              cursor: 'pointer' 
            }}
          >
            🧪 Debug Test
          </button>
          
          <button 
            onClick={handleFilterSeats} 
            style={{ 
              flex: 1,
              background: '#1976d2', 
              color: '#fff', 
              border: 'none', 
              borderRadius: 8, 
              padding: '12px 32px', 
              fontWeight: 700, 
              fontSize: 15, 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8
            }}
          >
            🔍 Apply Record Filter
          </button>
          {isFilterActive && (
            <button 
              onClick={handleResetFilter}
              style={{ 
                background: '#f5f5f5', 
                color: '#666', 
                border: '1px solid #ddd', 
                borderRadius: 8, 
                padding: '12px 16px', 
                fontWeight: 600, 
                fontSize: 15, 
                cursor: 'pointer' 
              }}
            >
              🔄
            </button>
          )}
        </div>
      </div>

      {showBehaviorInfo && (
        <div onClick={() => setShowBehaviorInfo(false)} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 40, left: 0, right: 0, margin: 'auto', width: 320, background: '#fff', borderRadius: 10, boxShadow: '0 4px 24px #888', padding: 18, zIndex: 1001 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1976d2', marginBottom: 8 }}>Behavior filter meaning</div>
            <div style={{ fontSize: 14, color: '#222', marginBottom: 8 }}>
              Passengers often complain when placed in a noisy area they do not want. Choosing the right noise level helps avoid behavioral conflicts and increases trip satisfaction.<br /><br />
              If there is not enough behavior data, the system will temporarily filter by train structure (quiet/regular coach).
            </div>
            <button onClick={() => setShowBehaviorInfo(false)} style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginTop: 8 }}>Close</button>
          </div>
        </div>
      )}
      <style>{`
        /* Dual Range Slider Styles */
        .dual-range-container input[type="range"] {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          cursor: pointer;
          outline: none;
        }
        
        .dual-range-container input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #fff;
          border: 3px solid #ec407a;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(236, 64, 122, 0.3);
          transition: all 0.15s ease-out;
        }
        
        .dual-range-container input[type="range"]::-webkit-slider-thumb:hover {
          box-shadow: 0 4px 12px rgba(236, 64, 122, 0.4);
          transform: scale(1.05);
        }
        
        .dual-range-container input[type="range"]::-webkit-slider-thumb:active {
          box-shadow: 0 6px 16px rgba(236, 64, 122, 0.5);
          transform: scale(1.1);
        }
        
        .dual-range-container input[type="range"]::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #fff;
          border: 3px solid #ec407a;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(236, 64, 122, 0.3);
          transition: all 0.15s ease-out;
        }
        
        .dual-range-container input[type="range"]::-moz-range-thumb:hover {
          box-shadow: 0 4px 12px rgba(236, 64, 122, 0.4);
          transform: scale(1.05);
        }
        
        .dual-range-container input[type="range"]::-moz-range-thumb:active {
          box-shadow: 0 6px 16px rgba(236, 64, 122, 0.5);
          transform: scale(1.1);
        }
        
        /* Radio button styles */
        input[type='radio'] {
          appearance: none;
          -webkit-appearance: none;
          width: 22px;
          height: 22px;
          border: 2px solid #000;
          border-radius: 50%;
          background: #fff;
          outline: none;
          cursor: pointer;
          position: relative;
          margin-right: 4px;
          vertical-align: middle;
          box-shadow: none;
          transition: border 0.2s, box-shadow 0.2s;
        }
        input[type='radio']:checked::before {
          content: '';
          display: block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #000;
          position: absolute;
          top: 3px;
          left: 3px;
        }
        input[type='radio']:not(:checked)::before {
          content: '';
          display: block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: transparent;
          position: absolute;
          top: 3px;
          left: 3px;
        }
        input[type='radio']:focus {
          box-shadow: 0 0 0 2px #1976d233;
        }
        
        input[type='checkbox'] {
          appearance: none;
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border: 2px solid #1976d2;
          border-radius: 4px;
          background: #fff;
          outline: none;
          cursor: pointer;
          position: relative;
          vertical-align: middle;
          transition: all 0.2s;
        }
        input[type='checkbox']:checked {
          background: #1976d2;
          border-color: #1976d2;
        }
        input[type='checkbox']:checked::before {
          content: '✓';
          display: block;
          color: #fff;
          font-size: 12px;
          font-weight: bold;
          text-align: center;
          line-height: 14px;
        }
        input[type='checkbox']:focus {
          box-shadow: 0 0 0 2px #1976d233;
        }
        
        @keyframes slideDown {
          from {
            transform: translateX(-50%) translateY(-20px);
            opacity: 0;
          }
          to {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slideUp {
          from {
            transform: scale(0.8) translateY(20px);
            opacity: 0;
          }
          to {
            transform: scale(1) translateY(0);
            opacity: 1;
          }
        }
      `}</style>
      {/* Popup gợi ý chọn ghế gần nhà vệ sinh nếu có trẻ em hoặc người cao tuổi */}
      {showWcSuggest && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.25)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 16,
            padding: '32px 24px',
            boxShadow: '0 4px 24px #0002',
            maxWidth: 340,
            textAlign: 'center',
          }}>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 12 }}>Suggestion</div>
            <div style={{ fontSize: 15, marginBottom: 20 }}>
              You should select a seat near the toilet because your group includes elderly or children.
            </div>
            <button onClick={() => setShowWcSuggest(false)} style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 32px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Filter Result Popup */}
      {showFilterResult && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.4)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'fadeIn 0.3s ease'
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 16,
            padding: '32px 24px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            maxWidth: 400,
            textAlign: 'center',
            transform: 'scale(1)',
            animation: 'slideUp 0.3s ease'
          }}>
            <div style={{ 
              fontSize: 24, 
              marginBottom: 8,
              color: '#4caf50'
            }}>
              ✅
            </div>
            <div style={{ 
              fontWeight: 700, 
              fontSize: 18, 
              marginBottom: 12,
              color: '#1976d2'
            }}>
              Filter Applied Successfully
            </div>
            <div style={{ 
              fontSize: 15, 
              marginBottom: 24,
              color: '#666',
              lineHeight: 1.5
            }}>
              {filterResultMessage}
            </div>
            <button 
              onClick={() => setShowFilterResult(false)} 
              style={{ 
                background: 'linear-gradient(45deg, #1976d2, #42a5f5)', 
                color: '#fff', 
                border: 'none', 
                borderRadius: 12, 
                padding: '12px 32px', 
                fontWeight: 700, 
                fontSize: 15, 
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(25, 118, 210, 0.3)',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(25, 118, 210, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(25, 118, 210, 0.3)';
              }}
            >
              OK, Got it!
            </button>
          </div>
        </div>
      )}
      </div>
    </>
  );
};

export default SelectSeat; 