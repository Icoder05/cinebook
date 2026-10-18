import type {
  BookingStatus,
  Format,
  MovieStatus,
  PaymentMethod,
  PaymentStatus,
  SeatState,
} from './constants';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: 'customer' | 'admin';
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface City {
  id: string;
  name: string;
  state: string;
}

export interface MovieSummary {
  id: string;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  languages: string[];
  genres: string[];
  certificate: string | null;
  rating: number | null;
  releaseDate: string | null;
  runtimeMin: number | null;
  status: MovieStatus;
}

export interface CastMember {
  name: string;
  character: string | null;
  profilePath: string | null;
}

export interface MovieDetail extends MovieSummary {
  overview: string | null;
  trailerKey: string | null;
  cast: CastMember[];
}

export interface ShowtimeChip {
  id: string;
  startsAt: string;
  format: Format;
  language: string;
  screenName: string;
  available: number;
  total: number;
  availability: 'AVAILABLE' | 'FILLING_FAST' | 'SOLD_OUT';
}

export interface MovieShowtimesResponse {
  movie: Pick<MovieSummary, 'id' | 'title' | 'certificate' | 'genres' | 'languages' | 'runtimeMin'>;
  date: string;
  dates: { date: string; hasShows: boolean }[];
  theatres: {
    id: string;
    name: string;
    address: string;
    amenities: string[];
    showtimes: ShowtimeChip[];
  }[];
}

export interface ScreenLayout {
  rows: number;
  cols: number;
  /** Column numbers after which an aisle gap is drawn. */
  aisles: number[];
  formats?: Format[];
}

export interface SeatMapSeat {
  id: string;
  row: string;
  col: number;
  tierId: string;
  state: SeatState;
}

export interface SeatMapResponse {
  showtime: {
    id: string;
    startsAt: string;
    format: Format;
    language: string;
    bookable: boolean;
  };
  movie: { id: string; title: string; certificate: string | null };
  theatre: { id: string; name: string; address: string; city: string };
  screen: { id: string; name: string; layout: ScreenLayout };
  tiers: { id: string; name: string; pricePaise: number; sortOrder: number }[];
  seats: SeatMapSeat[];
  myHold: { bookingId: string; holdExpiresAt: string } | null;
}

export interface PricedSeat {
  seatId: string;
  label: string;
  tierName: string;
  pricePaise: number;
}

export interface Pricing {
  seats: PricedSeat[];
  subtotalPaise: number;
  feePaise: number;
  taxPaise: number;
  totalPaise: number;
}

export interface HoldResponse {
  bookingId: string;
  holdExpiresAt: string;
  pricing: Pricing;
}

export interface BookingDetail {
  id: string;
  code: string;
  status: BookingStatus;
  seatCount: number;
  subtotalPaise: number;
  feePaise: number;
  taxPaise: number;
  totalPaise: number;
  holdExpiresAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  canCancel: boolean;
  serverTime: string;
  seats: { seatId: string; label: string; tierName: string; pricePaise: number }[];
  movie: { id: string; title: string; posterPath: string | null; certificate: string | null; languages: string[] };
  showtime: { id: string; startsAt: string; format: Format; language: string };
  theatre: { name: string; address: string; city: string };
  screen: { name: string };
  payment: {
    method: PaymentMethod;
    instrument: string | null;
    status: PaymentStatus;
    amountPaise: number;
    fakeTxnRef: string | null;
    failureReason: string | null;
  } | null;
  qrDataUrl: string | null;
}

export interface BookingListItem {
  id: string;
  code: string;
  status: BookingStatus;
  seatCount: number;
  totalPaise: number;
  seatLabels: string[];
  movie: { id: string; title: string; posterPath: string | null };
  showtime: { startsAt: string; format: Format; language: string };
  theatre: { name: string; city: string };
}

export interface PayResponse {
  paymentId: string;
  status: Extract<PaymentStatus, 'SUCCESS' | 'FAILED'>;
  bookingId: string;
  bookingStatus: BookingStatus;
  fakeTxnRef: string | null;
  failureReason: string | null;
  replayed: boolean;
}
