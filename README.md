# Chat API - Node.js RESTful Application

A simple chat application with RESTful API built using Node.js, Express, and JWT authentication.

## Features

- User registration and authentication
- JWT-based authentication
- Chat rooms
- Real-time messaging (REST-based)
- Input validation
- Rate limiting
- Security headers

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

For development:
```bash
npm run dev
```

## API Endpoints

### Authentication

#### Register User
- **POST** `/api/auth/register`
- **Body:**
```json
{
  "username": "string (min 3 chars)",
  "password": "string (min 6 chars)"
}
```

#### Login User
- **POST** `/api/auth/login`
- **Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

### Chat Rooms

#### Get All Rooms
- **GET** `/api/rooms`
- **Headers:** `Authorization: Bearer <token>`

#### Get Messages in Room
- **GET** `/api/rooms/:roomId/messages?limit=50&offset=0`
- **Headers:** `Authorization: Bearer <token>`

#### Send Message
- **POST** `/api/rooms/:roomId/messages`
- **Headers:** `Authorization: Bearer <token>`
- **Body:**
```json
{
  "content": "string (1-500 chars)"
}
```

### User Profile

#### Get User Profile
- **GET** `/api/users/profile`
- **Headers:** `Authorization: Bearer <token>`

## Usage Examples

### 1. Register a new user
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "john_doe", "password": "password123"}'
```

### 2. Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "john_doe", "password": "password123"}'
```

### 3. Get rooms (using token from login)
```bash
curl -X GET http://localhost:3000/api/rooms \
  -H "Authorization: Bearer <your-jwt-token>"
```

### 4. Send a message
```bash
curl -X POST http://localhost:3000/api/rooms/general/messages \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, world!"}'
```

### 5. Get messages from a room
```bash
curl -X GET "http://localhost:3000/api/rooms/general/messages?limit=10" \
  -H "Authorization: Bearer <your-jwt-token>"
```

## Default Rooms

The application starts with two default rooms:
- `general` - General discussion
- `random` - Random topics

## Security Features

- Password hashing with bcrypt
- JWT authentication
- Rate limiting (100 requests per 15 minutes)
- Input validation and sanitization
- Security headers with Helmet
- CORS enabled

## Environment Variables

- `PORT` - Server port (default: 3000)
- `JWT_SECRET` - JWT secret key (change in production)

## Data Storage

This application uses in-memory storage for simplicity. Data will be lost when the server restarts. For production use, consider integrating a database like MongoDB or PostgreSQL.

## Error Handling

The API returns appropriate HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error
