# CitasMedicas — Backend

API REST + WebSocket para un sistema de citas médicas: pacientes agendan con médicos, los médicos confirman o rechazan, y ambas partes se enteran **en tiempo real**.

Construida con [NestJS](https://nestjs.com/) + PostgreSQL (TypeORM). El cliente web está en [`citasmedicas-frontend`](../citasmedicas-frontend) (Vue 3).

## Stack

- **NestJS 11** (Express) + **TypeScript**
- **PostgreSQL** + **TypeORM** (`synchronize` en desarrollo, sin migraciones manuales)
- **JWT** (`@nestjs/jwt` + Passport) para autenticación, con guard de roles por endpoint
- **Socket.IO** (`@nestjs/websockets`) para las notificaciones en tiempo real
- **class-validator** para los DTOs de entrada
- **bcrypt** para el hash de contraseñas

## Módulos

| Módulo | Qué resuelve |
|---|---|
| `auth` | Registro (siempre crea un `patient`) y login. Emite el JWT. |
| `users` | Entidad `User` + `UserRole` compartidas por el resto de módulos. |
| `doctors` | Alta de médicos (solo `admin`), listado, detalle. |
| `patients` | Se crean implícitamente al registrarse. Sin endpoints públicos: solo lo consume internamente `appointments` para resolver el paciente dueño de una cita. |
| `appointments` | El corazón del sistema: horarios (`DoctorSlot`), citas (`Appointment`), y el `AppointmentsGateway` de WebSockets. |

## Modelo de datos

```
User (1) ── (1) Doctor ──┐
User (1) ── (1) Patient ─┤
                          ├── Appointment ── DoctorSlot
UserRole (1) ── (N) User ─┘
```

- Un `User` tiene un `UserRole` (`admin` | `doctor` | `patient`) y, según el rol, un `Doctor` o `Patient` asociado 1:1.
- `DoctorSlot` es un horario de una hora (`status: available | booked`).
- `Appointment` referencia un `Doctor`, un `Patient` y un `DoctorSlot`, con `status: pending | confirmed | rejected | cancelled | completed`.
  - `completed` no lo asigna el backend: el frontend lo calcula (una cita `confirmed` cuya hora ya pasó se muestra como completada).
  - La relación con `DoctorSlot` es `ManyToOne`, no `OneToOne`: una cita cancelada/rechazada no debe impedir que ese mismo horario se reserve de nuevo más adelante.

## Autenticación y roles

- Login/registro devuelven `{ access_token, user }`. El resto de endpoints van protegidos con `JwtAuthGuard` (Bearer token).
- Los endpoints sensibles además llevan `@Roles(...)` + `RolesGuard`, que compara contra el rol del usuario autenticado.
- La columna `password` del `User` tiene `select: false`: ningún endpoint la devuelve por accidente (ej. el listado de médicos, que hace `eager` de su `User`). Solo se vuelve a pedir explícitamente donde hace falta compararla (login).

## Endpoints

### Auth (`/auth`) — públicos

| Método | Ruta | Body | Descripción |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password, fullName }` | Crea un usuario `patient` |
| POST | `/auth/login` | `{ email, password }` | Devuelve el JWT |

### Médicos (`/doctors`) — requieren sesión

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/doctors` | cualquiera | Listado de médicos |
| GET | `/doctors/:id` | cualquiera | Detalle de un médico |
| POST | `/doctors` | `admin` | Da de alta un médico (crea `User` + `Doctor`) |

### Horarios y citas — requieren sesión

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/doctors/:doctorId/available-slots` | cualquiera | Horarios libres de hoy a los próximos 7 días (sin domingos, sin horas ya pasadas). Se auto-generan bajo demanda si faltan. |
| POST | `/appointments` | `patient` | Crea una cita sobre un `slotId` disponible |
| PATCH | `/appointments/:id/confirm` | `doctor` | Confirma una cita `pending` |
| PATCH | `/appointments/:id/reject` | `doctor` | Rechaza una cita `pending`, libera el horario |
| PATCH | `/appointments/:id/reschedule` | `doctor` | Mueve la cita a otro horario disponible |
| DELETE | `/appointments/:id` | doctor o paciente dueño | Cancela la cita, libera el horario |
| GET | `/appointments/my-appointments` | cualquiera | Citas del usuario autenticado (según su rol) |

## WebSocket (tiempo real)

El cliente se conecta a Socket.IO pasando el mismo JWT del login (`auth: { token }`). El gateway lo valida y lo une a una room `user:<id>`, así puede recibir eventos aunque no esté mirando la pantalla que originó el cambio.

| Evento | Se emite a | Cuándo |
|---|---|---|
| `appointment:created` | médico | un paciente agenda con él |
| `appointment:statusChanged` | paciente o médico (quien no actuó) | se confirma, rechaza o cancela una cita |
| `appointment:rescheduled` | paciente | el médico reagenda la cita |

## Requisitos

- Docker — para correr todo (API + Postgres) sin instalar nada más, **o bien**:
- Node.js 20+, pnpm, y una instancia de PostgreSQL propia

## Configuración

```bash
cp .env.example .env
```

| Variable | Descripción |
|---|---|
| `PORT` | Puerto de la API (ej. `3005`) |
| `NODE_ENV` | `development` habilita `synchronize` de TypeORM |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` | Conexión a Postgres |
| `JWT_SECRET` | Secreto para firmar los tokens |
| `JWT_EXPIRES_IN` | Duración del token **en segundos** (ej. `86400` = 24h). Debe ser un número, no un string tipo `"1d"` — `jsonwebtoken` interpreta un string numérico sin unidad como milisegundos. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Cuenta admin que se siembra automáticamente al levantar la app |
| `CORS_ORIGIN` | Origen(es) permitido(s), ej. `http://localhost:5173` (separar por coma si son varios) |

## Ejecución con Docker (recomendado, no requiere Node ni pnpm instalados)

```bash
docker compose up --build
```

Levanta Postgres **y** la API juntos. Con `NODE_ENV=development` (el valor por defecto en `.env`), TypeORM sincroniza el esquema automáticamente al iniciar — no hace falta correr migraciones. Al bootear, `SeedsService` siembra los tres roles (`admin`, `doctor`, `patient`) y la cuenta admin de `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Queda escuchando en `http://localhost:3005` (según `PORT`).

## Instalación y ejecución manual (sin Docker)

```bash
docker compose up -d postgres   # solo la base de datos
pnpm install
pnpm start:dev     # watch mode (http://localhost:3005 según PORT)
pnpm build         # compila a dist/
pnpm start:prod    # corre el build compilado
pnpm lint          # eslint --fix
```
