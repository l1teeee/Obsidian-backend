# Suscripciones con prueba gratuita de 14 días — Diseño

**Fecha:** 2026-07-04
**Estado:** aprobado en conversación, pendiente de plan de implementación

## Contexto

Obsidian Lens necesita monetización estilo Metricool: prueba gratuita de 14 días
al registrarse (sin método de pago), y después suscripción **anual** obligatoria
vía PayPal para seguir usando el producto.

Ya existe en el código:

- Módulo `payments` con confirmación de suscripción PayPal
  (`POST /payments/paypal/subscription`) y webhook (`POST /payments/paypal/webhook`)
  que actualizan `users.plan`, `users.plan_status` y `users.paypal_subscription_id`.
- Columna `users.is_admin` (los admins no deben verse afectados por el paywall).
- Planes `starter | pro | enterprise` (hoy solo controlan sesiones simultáneas
  vía `PLAN_SESSION_LIMITS` en `auth.service.ts`).
- Cron de mantenimiento (`src/jobs/maintenance.ts`) con patrón `isDue`/`markDone`
  sobre la tabla `_cron_runs`.
- Infraestructura de email (Brevo + react-email en `src/lib/emails/`).
- Infraestructura de límites de tokens IA por usuario (`modules/admin/token.service.ts`).

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Método de pago en el trial | Sin tarjeta: trial automático al registrarse; se pide suscribirse al expirar |
| Qué se bloquea al expirar | Todo excepto cuenta, perfil y pago (paywall duro) |
| Planes | Tres tiers anuales: `starter`, `pro`, `enterprise` |
| Límites por tier | Redes conectadas, posts programados/mes, créditos IA/mes, sesiones |
| Límites durante el trial | Los del plan `pro` |
| Emails | Recordatorio a 3 días del fin del trial + email al expirar |
| Cancelación | Mantiene acceso hasta el final del período anual ya pagado (`paid_until`) |
| Arquitectura | Estado en `users` + decorador `requireSubscription` + config de planes en código |

## Modelo de datos

Migración manual (no se versiona SQL en este repo):

```sql
ALTER TABLE users
  ADD COLUMN trial_ends_at          DATETIME   NULL     AFTER plan_status,
  ADD COLUMN paid_until             DATETIME   NULL     AFTER trial_ends_at,
  ADD COLUMN trial_reminder_sent    TINYINT(1) NOT NULL DEFAULT 0 AFTER paid_until,
  ADD COLUMN trial_expired_notified TINYINT(1) NOT NULL DEFAULT 0 AFTER trial_reminder_sent;
```

> **Nota:** si `plan_status` es un `ENUM`, la migración debe añadir además el valor
> `'trialing'` a la definición de la columna. Si es `VARCHAR`, no hace falta nada.

Opcional, para dar trial a los usuarios ya existentes sin suscripción activa:

```sql
UPDATE users
   SET trial_ends_at = NOW() + INTERVAL 14 DAY,
       plan_status   = 'trialing'
 WHERE (plan_status IS NULL OR plan_status NOT IN ('active'))
   AND trial_ends_at IS NULL;
```

## Ciclo de vida y derivación de estado

1. **Registro** (normal y Google OAuth): `trial_ends_at = NOW() + INTERVAL 14 DAY`,
   `plan = NULL`, `plan_status = 'trialing'`.
2. **Suscripción confirmada** (en cualquier momento): `plan_status = 'active'`,
   `plan` = tier real verificado contra PayPal (ver más abajo).
3. **Trial expira sin pagar**: sin cambio de fila; el bloqueo se deriva.
4. **Cancelación**: `plan_status = 'cancelled'`, `plan` se conserva,
   `paid_until` = `billing_info.next_billing_time` de PayPal. Acceso hasta `paid_until`.
5. **Expiración / suspensión (impago)** vía webhook: `plan_status = 'expired' | 'suspended'`
   → bloqueado por derivación.

Función pura única de decisión, `getSubscriptionState(row)`:

```
admin                                            → active, effectivePlan = enterprise
plan_status = 'active'                           → active, effectivePlan = plan
plan_status = 'cancelled' && paid_until > NOW()  → cancelled (con acceso), effectivePlan = plan
trial_ends_at > NOW()                            → trialing, effectivePlan = 'pro'
en cualquier otro caso                           → blocked, effectivePlan = null
```

Devuelve `{ status, plan, effectivePlan, trialEndsAt, trialDaysLeft, paidUntil }`.
Toda decisión de acceso y de límites sale de esta función.

## Enforcement

**Plugin `src/plugins/subscription.plugin.ts`** (patrón de `jwt.plugin.ts`) decora
`fastify.requireSubscription`:

1. Query única: `SELECT plan, plan_status, trial_ends_at, paid_until, is_admin
   FROM users WHERE id = ?`.
2. Deriva el estado con `getSubscriptionState`.
3. `blocked` → **402** `{ code: 'SUBSCRIPTION_REQUIRED' }` (el frontend redirige a precios).
4. Si pasa → `request.subscription = state` para los handlers.

Se añade como `preHandler: [fastify.authenticate, fastify.requireSubscription]` en
**todas** las rutas de: `posts`, `platforms`, `metrics`, `ai`, `ai-settings`,
`media`, `workspaces`.

Quedan **sin** el decorador (solo `authenticate` donde aplique): `auth`, `users`,
`payments`, `admin`, `/health`.

## Límites por plan

`src/config/plans.ts` — única fuente de verdad (valores provisionales, ajustables):

| Límite | starter | pro (= trial) | enterprise |
|---|---|---|---|
| Redes conectadas | 3 | 10 | ilimitado |
| Posts programados/mes | 50 | 500 | ilimitado |
| Créditos IA/mes | 20 | 200 | ilimitado |
| Sesiones simultáneas | 2 | 5 | 10 |

- `PLAN_SESSION_LIMITS` de `auth.service.ts` se elimina; el login lee de `plans.ts`
  (el override `users.max_sessions` se mantiene).
- **Conexiones**: en `platforms.service` al conectar — cuenta `social_connections`
  activas vs. límite del `effectivePlan` → `403 PLAN_LIMIT_REACHED`.
- **Posts/mes**: en `posts.service` al crear/programar — cuenta posts del usuario en
  el mes calendario en curso → `403 PLAN_LIMIT_REACHED`.
- **IA/mes**: el límite del plan actúa como valor por defecto cuando el admin no ha
  asignado un límite explícito en la infraestructura existente de `token.service`
  (no se crea contador paralelo). La infraestructura existente cuenta **tokens**,
  no créditos: los valores por plan se expresan como `aiTokensPerMonth`
  (50k / 500k / ilimitado, ajustables en `plans.ts`).
- **Corrección de seguridad adicional** (descubierta al planificar): se elimina
  `PATCH /users/me/plan`, que permitía a cualquier usuario auto-asignarse un plan
  sin pagar. `users.plan` pasa a escribirse solo desde los flujos verificados con
  PayPal (confirmación y webhook).

## Endpoints

### `GET /payments/subscription` (nuevo)

Solo `authenticate` (accesible bloqueado). Respuesta:

```json
{
  "status": "trialing | active | cancelled | blocked",
  "plan": "starter | pro | enterprise | null",
  "effectivePlan": "pro",
  "trialEndsAt": "2026-07-18T00:00:00Z",
  "trialDaysLeft": 9,
  "paidUntil": null,
  "limits": { "connections": 10, "postsPerMonth": 500, "aiCredits": 200 }
}
```

### `POST /payments/paypal/subscription` (corrección de seguridad)

Deja de confiar en el `planId` del cliente. Tras verificar la suscripción con
PayPal, lee el `plan_id` real de la respuesta y lo mapea a tier interno con env
nuevas: `PAYPAL_PLAN_ID_STARTER`, `PAYPAL_PLAN_ID_PRO`, `PAYPAL_PLAN_ID_ENTERPRISE`.
`plan_id` desconocido → `422 UNKNOWN_PAYPAL_PLAN`. Guarda también `paid_until`
(= `billing_info.next_billing_time`) y `plan_status = 'active'`.

### `POST /payments/paypal/subscription/cancel` (nuevo)

1. Lee la suscripción en PayPal → `billing_info.next_billing_time`.
2. `UPDATE users SET plan_status = 'cancelled', paid_until = ?` (conserva `plan`).
3. Llama a `POST /v1/billing/subscriptions/{id}/cancel` en PayPal.

### Webhook (correcciones)

- `CANCELLED`: `plan_status = 'cancelled'`, conserva `plan`, `paid_until` =
  `next_billing_time` del evento si está presente (hoy regala `plan = 'starter'` — se corrige).
- `EXPIRED`: `plan_status = 'expired'`, `plan = NULL` → bloqueado.
- `SUSPENDED` (impago): igual que hoy → bloqueado por derivación.
- `ACTIVATED`: además de `plan_status = 'active'`, actualiza `paid_until` si el
  evento trae `next_billing_time` (cubre reactivaciones).

## Cron de emails

Nueva tarea diaria `trial-emails` en `src/jobs/maintenance.ts` (patrón existente):

1. **Recordatorio** — usuarios cuyo estado derivado es `trialing`, con
   `trial_ends_at` entre `NOW()` y `NOW() + INTERVAL 3 DAY` y `trial_reminder_sent = 0`
   → email `TrialEndingSoon` → `trial_reminder_sent = 1`.
2. **Expirado** — usuarios con `trial_ends_at < NOW()`, sin suscripción activa ni
   `paid_until` vigente, `trial_expired_notified = 0` → email `TrialExpired` con
   enlace a precios → `trial_expired_notified = 1`.

Plantillas nuevas en `src/lib/emails/`: `TrialEndingSoon.tsx`, `TrialExpired.tsx`.
Si el envío falla, se loguea y **no** se marca el flag (reintento al día siguiente).

## Manejo de errores

Códigos nuevos, consistentes con el error handler global:

- `402 SUBSCRIPTION_REQUIRED` — trial vencido / sin suscripción vigente.
- `403 PLAN_LIMIT_REACHED` — límite del plan superado (conexiones, posts, IA).
- `422 UNKNOWN_PAYPAL_PLAN` — el `plan_id` de PayPal no mapea a ningún tier.

## Verificación

- `getSubscriptionState` se implementa como función pura y se cubre con tests
  unitarios (`vitest`, dev-dependency nueva): trialing, active, cancelled con y sin
  `paid_until` vigente, blocked, admin, bordes de fecha.
- Resto: `npx tsc --noEmit` + ejercitar endpoints en local con curl:
  trial activo → publica; trial vencido (simulado con `UPDATE`) → 402;
  confirmación de suscripción → desbloquea; cancelación → sigue activo hasta `paid_until`.

## Fuera de alcance

- Historial normalizado de suscripciones (tabla `subscriptions`) — PayPal ya guarda el historial.
- Cambio de plan (upgrade/downgrade) desde la app.
- Facturación mensual, cupones, impuestos.
- UI del frontend (banner de trial, página de precios) — solo se expone `GET /payments/subscription`.
