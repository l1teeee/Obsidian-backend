# Suscripciones + Trial de 14 días — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trial gratuito de 14 días al registrarse y paywall duro después: sin suscripción anual activa (PayPal) se bloquea todo excepto cuenta/perfil/pagos.

**Architecture:** El estado vive en la tabla `users` (`trial_ends_at`, `paid_until`, `plan`, `plan_status`). Una función pura `deriveSubscriptionState` decide el acceso; un decorador Fastify `requireSubscription` la aplica como `preHandler` en los módulos protegidos y responde 402 si está bloqueado. Los límites por plan viven en `src/config/plans.ts`.

**Tech Stack:** Fastify 5, TypeScript 5.9 strict (CommonJS), mysql2/promise, PayPal Billing Subscriptions API, Brevo + react-email, vitest (nuevo, solo para la función pura).

**Spec:** `docs/superpowers/specs/2026-07-04-subscriptions-trial-design.md`

## Global Constraints

- TypeScript strict con `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`. Para props opcionales usa spread condicional: `...(x && { name: x })` — nunca `{ name: x ?? undefined }`.
- `"type": "commonjs"` — imports estilo ES en fuente, compila a CJS.
- **No committear archivos `.sql`** — el esquema se aplica manualmente (política del repo).
- Código, comentarios y textos de email en **inglés**. El producto en emails se llama **Vielink**.
- Formato de error: lanzar `Object.assign(new Error(msg), { statusCode, errorCode })`; el handler global responde `{ success: false, error: { code, message } }`.
- Códigos de error nuevos: `402 SUBSCRIPTION_REQUIRED`, `403 PLAN_LIMIT_REACHED`, `422 UNKNOWN_PAYPAL_PLAN`, `404 NO_SUBSCRIPTION`.
- Type-check: `npx tsc --noEmit`. Tests: `npm test` (vitest, se añade en Task 2).
- Commits: mensaje convencional + trailer `Claude-Session: https://claude.ai/code/session_01LceEo83tQAGh7ySamTB5CF`.

---

### Task 1: Migración de BD (manual — requiere al usuario)

**Files:** ninguno en el repo (política: SQL no se versiona).

**Interfaces:**
- Produces: columnas `users.trial_ends_at DATETIME NULL`, `users.paid_until DATETIME NULL`, `users.trial_reminder_sent TINYINT(1) DEFAULT 0`, `users.trial_expired_notified TINYINT(1) DEFAULT 0`, y valor `'trialing'` aceptado en `users.plan_status`. Todas las tasks siguientes asumen que existen.

- [x] **Step 1: Pedir al usuario que aplique la migración**

Este paso es **bloqueante**: entregar el SQL al usuario y esperar su confirmación de que lo aplicó. Antes, comprobar el tipo de `plan_status`:

```sql
SHOW COLUMNS FROM users LIKE 'plan_status';
```

Si es `ENUM`, debe añadir `'trialing'` a la definición (mostrarle la lista actual y el `ALTER TABLE ... MODIFY` correspondiente conservando los valores existentes). Si es `VARCHAR`, no hace falta.

SQL principal:

```sql
ALTER TABLE users
  ADD COLUMN trial_ends_at          DATETIME   NULL     AFTER plan_status,
  ADD COLUMN paid_until             DATETIME   NULL     AFTER trial_ends_at,
  ADD COLUMN trial_reminder_sent    TINYINT(1) NOT NULL DEFAULT 0 AFTER paid_until,
  ADD COLUMN trial_expired_notified TINYINT(1) NOT NULL DEFAULT 0 AFTER trial_reminder_sent;
```

Opcional (dar trial de 14 días a los usuarios ya existentes sin suscripción activa):

```sql
UPDATE users
   SET trial_ends_at = NOW() + INTERVAL 14 DAY,
       plan_status   = 'trialing'
 WHERE (plan_status IS NULL OR plan_status NOT IN ('active'))
   AND trial_ends_at IS NULL;
```

- [x] **Step 2: Verificar que las columnas existen**

```bash
npx tsx -e "
const { pool } = require('./src/config/db');
(async () => {
  const [rows] = await pool.query(\"SHOW COLUMNS FROM users WHERE Field IN ('trial_ends_at','paid_until','trial_reminder_sent','trial_expired_notified')\");
  console.log(rows.map(r => r.Field));
  process.exit(rows.length === 4 ? 0 : 1);
})();
"
```

Expected: imprime los 4 nombres y exit 0. Si falla, volver al Step 1 — **no continuar con las demás tasks**.

---

### Task 2: Config de planes + derivación pura de estado + vitest

**Files:**
- Create: `src/config/plans.ts`
- Create: `src/modules/payments/subscription-state.ts`
- Test: `src/modules/payments/subscription-state.test.ts`
- Modify: `package.json` (devDependency `vitest`, script `test`)

**Interfaces:**
- Produces:
  - `PLANS: Record<'starter'|'pro'|'enterprise', PlanLimits>` con `PlanLimits = { maxConnections: number|null; postsPerMonth: number|null; aiTokensPerMonth: number|null; maxSessions: number }` (`null` = ilimitado).
  - `type PlanName = 'starter' | 'pro' | 'enterprise'`, `TRIAL_PLAN: PlanName = 'pro'`, `TRIAL_DAYS = 14`, `isPlanName(v: unknown): v is PlanName`.
  - `deriveSubscriptionState(row: SubscriptionFields, now?: Date): SubscriptionState` — **pura, sin imports de db/env** (para que el test no arranque `env.ts`, que exige variables de entorno).
  - `SubscriptionFields = { plan: string|null; plan_status: string|null; trial_ends_at: Date|null; paid_until: Date|null; is_admin: number }`.
  - `SubscriptionState = { status: 'trialing'|'active'|'cancelled'|'blocked'; plan: PlanName|null; effectivePlan: PlanName|null; trialEndsAt: Date|null; trialDaysLeft: number|null; paidUntil: Date|null }`.

- [x] **Step 1: Instalar vitest y añadir script**

```bash
npm install -D vitest
```

En `package.json`, añadir a `scripts`:

```json
"test": "vitest run"
```

- [x] **Step 2: Crear `src/config/plans.ts`**

```ts
// Single source of truth for plan tiers and their limits.
// null means unlimited. Adjust numbers here — nothing else hardcodes them.

export interface PlanLimits {
  maxConnections:   number | null;
  postsPerMonth:    number | null;
  aiTokensPerMonth: number | null;
  maxSessions:      number;
}

export const PLANS: Record<'starter' | 'pro' | 'enterprise', PlanLimits> = {
  starter:    { maxConnections: 3,    postsPerMonth: 50,   aiTokensPerMonth: 50_000,  maxSessions: 2 },
  pro:        { maxConnections: 10,   postsPerMonth: 500,  aiTokensPerMonth: 500_000, maxSessions: 5 },
  enterprise: { maxConnections: null, postsPerMonth: null, aiTokensPerMonth: null,    maxSessions: 10 },
};

export type PlanName = keyof typeof PLANS;

// Trial users operate with this tier's limits
export const TRIAL_PLAN: PlanName = 'pro';
export const TRIAL_DAYS = 14;

export function isPlanName(value: unknown): value is PlanName {
  return typeof value === 'string' && value in PLANS;
}
```

- [x] **Step 3: Escribir el test que falla** — `src/modules/payments/subscription-state.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { deriveSubscriptionState, SubscriptionFields } from './subscription-state';

const NOW = new Date('2026-07-04T12:00:00Z');

function row(overrides: Partial<SubscriptionFields> = {}): SubscriptionFields {
  return { plan: null, plan_status: null, trial_ends_at: null, paid_until: null, is_admin: 0, ...overrides };
}

describe('deriveSubscriptionState', () => {
  it('active subscription → active with its plan', () => {
    const state = deriveSubscriptionState(row({ plan: 'starter', plan_status: 'active' }), NOW);
    expect(state.status).toBe('active');
    expect(state.effectivePlan).toBe('starter');
  });

  it('trial in progress → trialing with the trial tier', () => {
    const state = deriveSubscriptionState(
      row({ plan_status: 'trialing', trial_ends_at: new Date('2026-07-10T12:00:00Z') }), NOW,
    );
    expect(state.status).toBe('trialing');
    expect(state.effectivePlan).toBe('pro');
    expect(state.trialDaysLeft).toBe(6);
  });

  it('expired trial without subscription → blocked', () => {
    const state = deriveSubscriptionState(
      row({ plan_status: 'trialing', trial_ends_at: new Date('2026-07-01T12:00:00Z') }), NOW,
    );
    expect(state.status).toBe('blocked');
    expect(state.effectivePlan).toBeNull();
  });

  it('cancelled with paid period remaining → keeps access', () => {
    const state = deriveSubscriptionState(
      row({ plan: 'pro', plan_status: 'cancelled', paid_until: new Date('2026-12-01T00:00:00Z') }), NOW,
    );
    expect(state.status).toBe('cancelled');
    expect(state.effectivePlan).toBe('pro');
  });

  it('cancelled with paid period over → blocked', () => {
    const state = deriveSubscriptionState(
      row({ plan: 'pro', plan_status: 'cancelled', paid_until: new Date('2026-07-01T00:00:00Z') }), NOW,
    );
    expect(state.status).toBe('blocked');
  });

  it('suspended (payment failure) → blocked even with future paid_until', () => {
    const state = deriveSubscriptionState(
      row({ plan: 'pro', plan_status: 'suspended', paid_until: new Date('2026-12-01T00:00:00Z') }), NOW,
    );
    expect(state.status).toBe('blocked');
  });

  it('admin → always active as enterprise', () => {
    const state = deriveSubscriptionState(row({ is_admin: 1 }), NOW);
    expect(state.status).toBe('active');
    expect(state.effectivePlan).toBe('enterprise');
  });

  it('unknown plan name with active status → blocked', () => {
    const state = deriveSubscriptionState(row({ plan: 'studio', plan_status: 'active' }), NOW);
    expect(state.status).toBe('blocked');
  });

  it('trial ending exactly now → blocked (boundary)', () => {
    const state = deriveSubscriptionState(row({ trial_ends_at: NOW }), NOW);
    expect(state.status).toBe('blocked');
  });

  it('active subscription ignores an expired trial', () => {
    const state = deriveSubscriptionState(
      row({ plan: 'enterprise', plan_status: 'active', trial_ends_at: new Date('2026-06-01T00:00:00Z') }), NOW,
    );
    expect(state.status).toBe('active');
    expect(state.effectivePlan).toBe('enterprise');
    expect(state.trialDaysLeft).toBeNull();
  });
});
```

- [x] **Step 4: Verificar que falla**

```bash
npm test
```

Expected: FAIL — `Cannot find module './subscription-state'` (o similar).

- [x] **Step 5: Implementar `src/modules/payments/subscription-state.ts`**

**IMPORTANTE:** este archivo NO debe importar `db`, `env` ni nada que los importe — solo `config/plans`.

```ts
// Pure derivation of a user's subscription/trial state.
// Keep this file free of db/env imports so it stays unit-testable.
import { PlanName, TRIAL_PLAN, isPlanName } from '../../config/plans';

export type SubscriptionStatus = 'trialing' | 'active' | 'cancelled' | 'blocked';

export interface SubscriptionFields {
  plan:          string | null;
  plan_status:   string | null;
  trial_ends_at: Date | null;
  paid_until:    Date | null;
  is_admin:      number;
}

export interface SubscriptionState {
  status:        SubscriptionStatus;
  plan:          PlanName | null;
  effectivePlan: PlanName | null;
  trialEndsAt:   Date | null;
  trialDaysLeft: number | null;
  paidUntil:     Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function deriveSubscriptionState(
  row: SubscriptionFields,
  now: Date = new Date(),
): SubscriptionState {
  const plan        = isPlanName(row.plan) ? row.plan : null;
  const trialEndsAt = row.trial_ends_at;
  const paidUntil   = row.paid_until;
  const trialActive = trialEndsAt !== null && trialEndsAt.getTime() > now.getTime();

  const base = {
    plan,
    trialEndsAt,
    trialDaysLeft: trialActive
      ? Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS)
      : null,
    paidUntil,
  };

  if (row.is_admin) {
    return { ...base, status: 'active', effectivePlan: 'enterprise' };
  }
  if (row.plan_status === 'active' && plan) {
    return { ...base, status: 'active', effectivePlan: plan };
  }
  // Cancelled subscriptions keep access until the end of the paid period
  if (
    row.plan_status === 'cancelled' && plan &&
    paidUntil !== null && paidUntil.getTime() > now.getTime()
  ) {
    return { ...base, status: 'cancelled', effectivePlan: plan };
  }
  if (trialActive) {
    return { ...base, status: 'trialing', effectivePlan: TRIAL_PLAN };
  }
  return { ...base, status: 'blocked', effectivePlan: null };
}
```

- [x] **Step 6: Verificar que pasa**

```bash
npm test && npx tsc --noEmit
```

Expected: 10 tests PASS, tsc sin errores.

- [x] **Step 7: Commit**

```bash
git add src/config/plans.ts src/modules/payments/subscription-state.ts src/modules/payments/subscription-state.test.ts package.json package-lock.json
git commit -m "feat: plan tiers config and pure subscription state derivation"
```

⚠️ `package.json`/`package-lock.json` pueden tener cambios previos no relacionados en el working tree — revisar `git diff package.json` y committear solo lo pertinente (si hay cambios ajenos, usar `git add -p`).

---

### Task 3: Decorador `requireSubscription` + cableado del paywall

**Files:**
- Create: `src/modules/payments/subscriptions.service.ts`
- Create: `src/plugins/subscription.plugin.ts`
- Modify: `src/types/fastify.d.ts`
- Modify: `src/app.ts` (registrar plugin)
- Modify: `src/modules/posts/posts.routes.ts`, `src/modules/ai/ai.routes.ts`, `src/modules/ai-settings/ai-settings.routes.ts`, `src/modules/media/media.routes.ts`, `src/modules/workspaces/workspaces.routes.ts`, `src/modules/platforms/platforms.routes.ts`, `src/modules/metrics/metrics.routes.ts`

**Interfaces:**
- Consumes: `deriveSubscriptionState`, `SubscriptionState`, `SubscriptionFields` (Task 2).
- Produces:
  - `getSubscriptionState(userId: string): Promise<SubscriptionState>` en `subscriptions.service.ts` (lanza `404 USER_NOT_FOUND` si el usuario no existe).
  - Decorador `fastify.requireSubscription(request, reply): Promise<void>` y `request.subscription?: SubscriptionState`.

- [x] **Step 1: Crear `src/modules/payments/subscriptions.service.ts`**

```ts
import { RowDataPacket } from 'mysql2';
import { pool } from '../../config/db';
import {
  deriveSubscriptionState,
  SubscriptionFields,
  SubscriptionState,
} from './subscription-state';

interface StateRow extends RowDataPacket, SubscriptionFields {}

export async function getSubscriptionState(userId: string): Promise<SubscriptionState> {
  const [rows] = await pool.query<StateRow[]>(
    'SELECT plan, plan_status, trial_ends_at, paid_until, is_admin FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  if (!rows[0]) {
    throw Object.assign(new Error('User not found'), {
      statusCode: 404,
      errorCode:  'USER_NOT_FOUND',
    });
  }
  return deriveSubscriptionState(rows[0]);
}
```

- [x] **Step 2: Crear `src/plugins/subscription.plugin.ts`**

```ts
import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getSubscriptionState } from '../modules/payments/subscriptions.service';

const subscriptionPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate(
    'requireSubscription',
    async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      // Unauthenticated routes in guarded modules (OAuth callbacks) are skipped —
      // they validate access through their own signed state parameter.
      if (!request.user) return;

      const state = await getSubscriptionState(request.user.id);
      if (state.status === 'blocked') {
        throw Object.assign(
          new Error('Your free trial has ended. An active subscription is required.'),
          { statusCode: 402, errorCode: 'SUBSCRIPTION_REQUIRED' },
        );
      }
      request.subscription = state;
    },
  );
};

export default fp(subscriptionPlugin);
```

- [x] **Step 3: Ampliar `src/types/fastify.d.ts`**

Archivo completo resultante:

```ts
import { FastifyRequest, FastifyReply } from 'fastify';
import type { SubscriptionState } from '../modules/payments/subscription-state';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id:    string;
      email: string;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate:        (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSubscription: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    subscription?: SubscriptionState;
  }
}
```

- [x] **Step 4: Registrar el plugin en `src/app.ts`**

Añadir el import junto a los demás plugins:

```ts
import subscriptionPlugin from './plugins/subscription.plugin';
```

Y registrarlo justo después de `fastify.register(authenticatePlugin);`:

```ts
fastify.register(authenticatePlugin);
fastify.register(subscriptionPlugin);
```

- [x] **Step 5: Cablear los 7 módulos protegidos**

En módulos con hook de instancia (`posts`, `ai-settings`, `media`, `workspaces`), añadir la línea **inmediatamente después** de `fastify.addHook('preHandler', fastify.authenticate);`:

```ts
fastify.addHook('preHandler', fastify.requireSubscription);
```

En `src/modules/ai/ai.routes.ts` el orden importa — debe quedar **antes** de `tokenLimitGuard`:

```ts
fastify.addHook('preHandler', fastify.authenticate);
fastify.addHook('preHandler', fastify.requireSubscription);
fastify.addHook('preHandler', tokenLimitGuard);
```

En `platforms.routes.ts` y `metrics.routes.ts` la autenticación es por ruta con `onRequest: [fastify.authenticate]` — como `onRequest` corre antes que `preHandler`, basta con añadir al **inicio** del plugin (primera línea dentro de la función):

```ts
fastify.addHook('preHandler', fastify.requireSubscription);
```

Los callbacks OAuth de platforms no llevan `authenticate`, así que `request.user` es `undefined` y el decorador los deja pasar (por diseño, ver Step 2).

- [x] **Step 6: Verificar**

```bash
npx tsc --noEmit && npm test
```

Expected: sin errores, tests siguen en verde.

Verificación funcional con el servidor dev (`npm run dev` en background) y un usuario de prueba:

```bash
# 1. Con un access token de un usuario en trial vigente:
curl -s http://localhost:3000/posts -H "Authorization: Bearer $TOKEN" | head -c 200
# Expected: respuesta normal (200)

# 2. Simular trial vencido (SQL manual): UPDATE users SET trial_ends_at = NOW() - INTERVAL 1 DAY WHERE email = '<test>';
curl -s http://localhost:3000/posts -H "Authorization: Bearer $TOKEN"
# Expected: {"success":false,"error":{"code":"SUBSCRIPTION_REQUIRED",...}} con HTTP 402

# 3. El perfil sigue accesible bloqueado:
curl -s http://localhost:3000/users/me -H "Authorization: Bearer $TOKEN" | head -c 200
# Expected: 200

# 4. Restaurar: UPDATE users SET trial_ends_at = NOW() + INTERVAL 14 DAY WHERE email = '<test>';
```

- [x] **Step 7: Commit**

```bash
git add src/modules/payments/subscriptions.service.ts src/plugins/subscription.plugin.ts src/types/fastify.d.ts src/app.ts src/modules/posts/posts.routes.ts src/modules/ai/ai.routes.ts src/modules/ai-settings/ai-settings.routes.ts src/modules/media/media.routes.ts src/modules/workspaces/workspaces.routes.ts src/modules/platforms/platforms.routes.ts src/modules/metrics/metrics.routes.ts
git commit -m "feat: subscription paywall — requireSubscription decorator wired into protected modules"
```

---

### Task 4: Verificación del plan en servidor + correcciones del webhook

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/modules/payments/payments.service.ts`
- Modify: `src/modules/payments/payments.schema.ts`
- Modify: `src/modules/payments/payments.controller.ts`
- Modify: `src/modules/users/users.routes.ts`, `src/modules/users/users.controller.ts`, `src/modules/users/users.service.ts`, `src/modules/users/users.schema.ts` (eliminar `PATCH /users/me/plan`)

**Interfaces:**
- Consumes: `PlanName`, `isPlanName` (Task 2).
- Produces:
  - `env.PAYPAL_PLAN_ID_STARTER | _PRO | _ENTERPRISE: string`.
  - `confirmSubscription(userId: string, subscriptionId: string): Promise<void>` — **firma nueva, sin `planId`**.
  - `PaypalSubscriptionResponse` con `plan_id` y `billing_info.next_billing_time` (lo reutiliza Task 5).

- [x] **Step 1: Añadir env vars en `src/config/env.ts`**

Tras la línea de `PAYPAL_API_BASE`:

```ts
  // PayPal billing plan IDs (from the PayPal dashboard) — server-side mapping to internal tiers.
  // Never trust a tier name sent by the client.
  PAYPAL_PLAN_ID_STARTER:    process.env['PAYPAL_PLAN_ID_STARTER']    ?? '',
  PAYPAL_PLAN_ID_PRO:        process.env['PAYPAL_PLAN_ID_PRO']        ?? '',
  PAYPAL_PLAN_ID_ENTERPRISE: process.env['PAYPAL_PLAN_ID_ENTERPRISE'] ?? '',
```

- [x] **Step 2: Reescribir `confirmSubscription` en `payments.service.ts`**

Ampliar la interfaz existente y añadir el mapeo:

```ts
interface PaypalSubscriptionResponse {
  status:        string;
  plan_id?:      string;
  billing_info?: { next_billing_time?: string };
}

function paypalPlanToTier(paypalPlanId: string): PlanName | null {
  if (!paypalPlanId) return null;
  const map: Record<string, PlanName | undefined> = {
    [env.PAYPAL_PLAN_ID_STARTER]:    'starter',
    [env.PAYPAL_PLAN_ID_PRO]:        'pro',
    [env.PAYPAL_PLAN_ID_ENTERPRISE]: 'enterprise',
  };
  return map[paypalPlanId] ?? null;
}
```

(Import necesario: `import { PlanName } from '../../config/plans';`)

Reemplazar `confirmSubscription` completa:

```ts
export async function confirmSubscription(
  userId:         string,
  subscriptionId: string,
): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch(
    `${env.PAYPAL_API_BASE}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );

  if (!res.ok) {
    throw Object.assign(new Error('Could not verify subscription with PayPal'), {
      statusCode: 422,
      errorCode:  'SUBSCRIPTION_VERIFY_FAILED',
    });
  }

  const sub = await res.json() as PaypalSubscriptionResponse;

  // APPROVAL_PENDING is acceptable: PayPal may not have activated it yet
  if (!['ACTIVE', 'APPROVAL_PENDING'].includes(sub.status)) {
    throw Object.assign(new Error(`Subscription is not active (status: ${sub.status})`), {
      statusCode: 422,
      errorCode:  'SUBSCRIPTION_NOT_ACTIVE',
    });
  }

  // Map the plan_id reported by PayPal — never the one claimed by the client
  const plan = paypalPlanToTier(sub.plan_id ?? '');
  if (!plan) {
    throw Object.assign(new Error('PayPal plan does not match any known tier'), {
      statusCode: 422,
      errorCode:  'UNKNOWN_PAYPAL_PLAN',
    });
  }

  const paidUntil = sub.billing_info?.next_billing_time
    ? new Date(sub.billing_info.next_billing_time)
    : null;

  await pool.query<ResultSetHeader>(
    `UPDATE users
        SET paypal_subscription_id = ?,
            plan                   = ?,
            plan_status            = 'active',
            paid_until             = ?
      WHERE id = ?`,
    [subscriptionId, plan, paidUntil, userId],
  );
}
```

- [x] **Step 3: Corregir el `switch` del webhook en `handleWebhook`**

Reemplazar los cases por:

```ts
  switch (eventType) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      const billing = resource['billing_info'] as { next_billing_time?: string } | undefined;
      const plan    = paypalPlanToTier((resource['plan_id'] as string) ?? '');
      await pool.query<ResultSetHeader>(
        `UPDATE users
            SET plan_status = 'active',
                plan        = COALESCE(?, plan),
                paid_until  = COALESCE(?, paid_until)
          WHERE paypal_subscription_id = ?`,
        [plan, billing?.next_billing_time ? new Date(billing.next_billing_time) : null, subId],
      );
      break;
    }

    case 'BILLING.SUBSCRIPTION.CANCELLED': {
      // Access continues until the end of the already-paid period (paid_until)
      const billing = resource['billing_info'] as { next_billing_time?: string } | undefined;
      await pool.query<ResultSetHeader>(
        `UPDATE users
            SET plan_status = 'cancelled',
                paid_until  = COALESCE(?, paid_until)
          WHERE paypal_subscription_id = ?`,
        [billing?.next_billing_time ? new Date(billing.next_billing_time) : null, subId],
      );
      break;
    }

    case 'BILLING.SUBSCRIPTION.EXPIRED':
      await pool.query<ResultSetHeader>(
        `UPDATE users SET plan_status = 'expired', plan = NULL WHERE paypal_subscription_id = ?`,
        [subId],
      );
      break;

    case 'BILLING.SUBSCRIPTION.SUSPENDED':
      await pool.query<ResultSetHeader>(
        `UPDATE users SET plan_status = 'suspended' WHERE paypal_subscription_id = ?`,
        [subId],
      );
      break;

    default:
      // Unhandled event type — acknowledge receipt, take no action
      break;
  }
```

(El case `CANCELLED` original hacía `plan = 'starter'` — regalaba un tier de pago. El `EXPIRED` original también.)

- [x] **Step 4: Actualizar schema y controller**

`payments.schema.ts` — el body ya no lleva `planId` (el enum viejo incluía `'studio'`, que ni existe como tier):

```ts
export const confirmSubscriptionSchema = {
  body: {
    type: 'object',
    required: ['subscriptionId'],
    additionalProperties: false,
    properties: {
      subscriptionId: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
};
```

`payments.controller.ts` — actualizar tipo y llamada:

```ts
type ConfirmSubscriptionBody = {
  subscriptionId: string;
};

export async function confirmSubscriptionHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const userId = (request.user as { id: string }).id;
  const body   = request.body as ConfirmSubscriptionBody;
  await paymentsService.confirmSubscription(userId, body.subscriptionId);
  reply.send({ success: true, data: null });
}
```

**Nota frontend:** si el cliente enviaba `planId`, con `additionalProperties: false` ahora recibiría 400. El frontend aún no está integrado (datos mockeados), así que no rompe nada — pero documentarlo en el mensaje de commit.

- [x] **Step 5: Eliminar `PATCH /users/me/plan` (auto-asignación de plan)**

El endpoint permite a cualquier usuario ponerse `plan = 'enterprise'` sin pagar. Con el nuevo modelo, `users.plan` solo lo escriben los flujos verificados con PayPal (confirm/webhook). Eliminar:

- `src/modules/users/users.routes.ts`: la línea `fastify.patch('/me/plan', ...)` (~línea 70).
- `src/modules/users/users.controller.ts`: `updatePlanHandler` completo (~línea 40).
- `src/modules/users/users.service.ts`: `updatePlan` completo (~línea 80). Si el tipo `UserPlan` queda sin uso, eliminarlo también.
- `src/modules/users/users.schema.ts`: `updatePlanSchema` y su export.

Comprobar que no quedan referencias:

```bash
grep -rn "updatePlan\|me/plan" src/
```

Expected: sin resultados.

- [x] **Step 6: Verificar y commit**

```bash
npx tsc --noEmit && npm test
git add src/config/env.ts src/modules/payments/payments.service.ts src/modules/payments/payments.schema.ts src/modules/payments/payments.controller.ts src/modules/users/users.routes.ts src/modules/users/users.controller.ts src/modules/users/users.service.ts src/modules/users/users.schema.ts
git commit -m "fix: verify PayPal plan_id server-side; remove self-service plan endpoint

Stops granting starter on cancel/expire and removes PATCH /users/me/plan —
users.plan is now written only by PayPal-verified flows.
BREAKING: POST /payments/paypal/subscription no longer accepts planId in the body."
```

---

### Task 5: `GET /payments/subscription` + endpoint de cancelación

**Files:**
- Modify: `src/modules/payments/payments.service.ts`
- Modify: `src/modules/payments/payments.controller.ts`
- Modify: `src/modules/payments/payments.routes.ts`

**Interfaces:**
- Consumes: `getSubscriptionState` (Task 3), `PLANS` (Task 2), `PaypalSubscriptionResponse`, `getAccessToken` (Task 4).
- Produces: `cancelSubscription(userId: string): Promise<void>`.

- [x] **Step 1: Añadir `cancelSubscription` a `payments.service.ts`**

```ts
interface SubIdRow extends RowDataPacket {
  paypal_subscription_id: string | null;
}

export async function cancelSubscription(userId: string): Promise<void> {
  const [rows] = await pool.query<SubIdRow[]>(
    'SELECT paypal_subscription_id FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  const subId = rows[0]?.paypal_subscription_id;
  if (!subId) {
    throw Object.assign(new Error('No subscription to cancel'), {
      statusCode: 404,
      errorCode:  'NO_SUBSCRIPTION',
    });
  }

  const token = await getAccessToken();

  // Capture the end of the already-paid period before cancelling —
  // the user keeps access until then.
  let paidUntil: Date | null = null;
  const detailRes = await fetch(
    `${env.PAYPAL_API_BASE}/v1/billing/subscriptions/${encodeURIComponent(subId)}`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
  );
  if (detailRes.ok) {
    const sub = await detailRes.json() as PaypalSubscriptionResponse;
    if (sub.billing_info?.next_billing_time) {
      paidUntil = new Date(sub.billing_info.next_billing_time);
    }
  }

  // Cancel at PayPal FIRST: if this fails we must not mark the user cancelled
  // while PayPal keeps charging them.
  const cancelRes = await fetch(
    `${env.PAYPAL_API_BASE}/v1/billing/subscriptions/${encodeURIComponent(subId)}/cancel`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ reason: 'Cancelled by the user from the app' }),
    },
  );
  if (!cancelRes.ok) {
    throw Object.assign(new Error('PayPal refused to cancel the subscription'), {
      statusCode: 502,
      errorCode:  'PAYPAL_CANCEL_FAILED',
    });
  }

  await pool.query<ResultSetHeader>(
    `UPDATE users
        SET plan_status = 'cancelled',
            paid_until  = COALESCE(?, paid_until)
      WHERE id = ?`,
    [paidUntil, userId],
  );
}
```

(Import necesario: `RowDataPacket` desde `mysql2` — ampliar el import existente de `ResultSetHeader`. Nota: el spec listaba "update → cancel"; aquí se cancela primero en PayPal deliberadamente para no marcar cancelado a alguien a quien PayPal seguiría cobrando. El webhook `CANCELLED` posterior es idempotente con este UPDATE.)

- [x] **Step 2: Añadir handlers en `payments.controller.ts`**

```ts
import { getSubscriptionState } from './subscriptions.service';
import { PLANS } from '../../config/plans';

export async function getSubscriptionHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const userId = (request.user as { id: string }).id;
  const state  = await getSubscriptionState(userId);
  const limits = state.effectivePlan
    ? {
        connections:      PLANS[state.effectivePlan].maxConnections,
        postsPerMonth:    PLANS[state.effectivePlan].postsPerMonth,
        aiTokensPerMonth: PLANS[state.effectivePlan].aiTokensPerMonth,
        sessions:         PLANS[state.effectivePlan].maxSessions,
      }
    : null;

  reply.send({
    success: true,
    data: {
      status:        state.status,
      plan:          state.plan,
      effectivePlan: state.effectivePlan,
      trialEndsAt:   state.trialEndsAt?.toISOString() ?? null,
      trialDaysLeft: state.trialDaysLeft,
      paidUntil:     state.paidUntil?.toISOString() ?? null,
      limits,
    },
  });
}

export async function cancelSubscriptionHandler(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const userId = (request.user as { id: string }).id;
  await paymentsService.cancelSubscription(userId);
  reply.send({ success: true, data: null });
}
```

- [x] **Step 3: Añadir rutas en `payments.routes.ts`**

```ts
  fastify.get('/subscription', {
    preHandler: [fastify.authenticate],
    config:     { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, controller.getSubscriptionHandler);

  fastify.post('/paypal/subscription/cancel', {
    preHandler: [fastify.authenticate],
    config:     { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, controller.cancelSubscriptionHandler);
```

(Sin `requireSubscription` a propósito: un usuario bloqueado debe poder consultar su estado y pagar.)

- [x] **Step 4: Verificar**

```bash
npx tsc --noEmit && npm test
```

Con servidor dev y token de prueba:

```bash
curl -s http://localhost:3000/payments/subscription -H "Authorization: Bearer $TOKEN"
# Expected: {"success":true,"data":{"status":"trialing","effectivePlan":"pro","trialDaysLeft":<n>,...,"limits":{...}}}
```

- [x] **Step 5: Commit**

```bash
git add src/modules/payments/payments.service.ts src/modules/payments/payments.controller.ts src/modules/payments/payments.routes.ts
git commit -m "feat: subscription status endpoint and PayPal cancellation with paid-period grace"
```

---

### Task 6: Trial al registrarse + sesiones desde plans.ts

**Files:**
- Modify: `src/modules/auth/auth.service.ts`

**Interfaces:**
- Consumes: `PLANS`, `TRIAL_PLAN`, `TRIAL_DAYS`, `isPlanName` (Task 2).

- [x] **Step 1: Iniciar el trial en el registro normal**

En `register()` (~línea 119), reemplazar el INSERT:

```ts
  await pool.query<ResultSetHeader>(
    `INSERT INTO users (id, email, password_hash, email_verification_token, plan_status, trial_ends_at)
     VALUES (?, ?, ?, ?, 'trialing', DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [id, email, passwordHash, verificationCode, TRIAL_DAYS],
  );
```

- [x] **Step 2: Iniciar el trial en el registro vía Google**

En `googleAuth` (~línea 367), reemplazar el INSERT de usuario nuevo:

```ts
    await pool.query<ResultSetHeader>(
      `INSERT INTO users (id, email, password_hash, name, email_verified, is_active, plan_status, trial_ends_at)
       VALUES (?, ?, ?, ?, 1, 1, 'trialing', DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [userId, email, placeholderHash, name ?? null, TRIAL_DAYS],
    );
```

- [x] **Step 3: Sesiones desde `plans.ts`**

Eliminar el bloque `PLAN_SESSION_LIMITS` (líneas 13-18) y añadir el import:

```ts
import { PLANS, TRIAL_PLAN, TRIAL_DAYS, isPlanName } from '../../config/plans';
```

Reemplazar la línea `const maxSessions = user.max_sessions ?? PLAN_SESSION_LIMITS[user.plan ?? ''] ?? 1;` por:

```ts
  // Explicit max_sessions overrides the plan default. Users without a paid
  // plan (trial or blocked) get the trial tier's session allowance.
  const planSessions = isPlanName(user.plan) ? PLANS[user.plan].maxSessions : PLANS[TRIAL_PLAN].maxSessions;
  const maxSessions  = user.max_sessions ?? planSessions;
```

- [x] **Step 4: Verificar**

```bash
npx tsc --noEmit && npm test
```

Funcional: registrar un usuario nuevo y comprobar en BD que `plan_status = 'trialing'` y `trial_ends_at` ≈ hoy + 14 días; luego `GET /payments/subscription` con su token → `status: "trialing"`, `trialDaysLeft: 14`.

- [x] **Step 5: Commit**

```bash
git add src/modules/auth/auth.service.ts
git commit -m "feat: start 14-day trial at registration; session limits from plans config"
```

---

### Task 7: Límites de conexiones y de posts/mes

**Files:**
- Modify: `src/modules/payments/subscriptions.service.ts`
- Modify: `src/modules/platforms/platforms.service.ts`
- Modify: `src/modules/posts/posts.service.ts`

**Interfaces:**
- Consumes: `getSubscriptionState` (Task 3), `PLANS`, `PlanName` (Task 2).
- Produces: `assertConnectionLimit(userId: string): Promise<void>` y `assertMonthlyPostLimit(userId: string): Promise<void>` en `subscriptions.service.ts`.

- [x] **Step 1: Añadir helpers de límite a `subscriptions.service.ts`**

```ts
import { PLANS, PlanName } from '../../config/plans';

interface CountRow extends RowDataPacket { n: number }

async function requireEffectivePlan(userId: string): Promise<PlanName> {
  const state = await getSubscriptionState(userId);
  if (!state.effectivePlan) {
    throw Object.assign(
      new Error('Your free trial has ended. An active subscription is required.'),
      { statusCode: 402, errorCode: 'SUBSCRIPTION_REQUIRED' },
    );
  }
  return state.effectivePlan;
}

export async function assertConnectionLimit(userId: string): Promise<void> {
  const plan  = await requireEffectivePlan(userId);
  const limit = PLANS[plan].maxConnections;
  if (limit === null) return; // unlimited

  const [rows] = await pool.query<CountRow[]>(
    'SELECT COUNT(*) AS n FROM social_connections WHERE user_id = ? AND is_active = 1',
    [userId],
  );
  if ((rows[0]?.n ?? 0) >= limit) {
    throw Object.assign(
      new Error(`Your plan allows up to ${limit} connected social accounts`),
      { statusCode: 403, errorCode: 'PLAN_LIMIT_REACHED' },
    );
  }
}

export async function assertMonthlyPostLimit(userId: string): Promise<void> {
  const plan  = await requireEffectivePlan(userId);
  const limit = PLANS[plan].postsPerMonth;
  if (limit === null) return; // unlimited

  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS n
       FROM posts
      WHERE user_id = ?
        AND status <> 'draft'
        AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
    [userId],
  );
  if ((rows[0]?.n ?? 0) >= limit) {
    throw Object.assign(
      new Error(`Your plan allows up to ${limit} scheduled or published posts per month`),
      { statusCode: 403, errorCode: 'PLAN_LIMIT_REACHED' },
    );
  }
}
```

- [x] **Step 2: Aplicar en `platforms.service.ts`**

Import:

```ts
import { assertConnectionLimit } from '../payments/subscriptions.service';
```

Añadir `await assertConnectionLimit(userId);` como **primera línea** del cuerpo de estas 4 funciones (los puntos de entrada que crean conexiones):

- `linkInstagramFromExistingPages` (~línea 159)
- `handleInstagramDirectCallback` (~línea 258)
- `selectFacebookPage` (~línea 397)
- `handleFacebookCallback` (~línea 502)

Limitación aceptada (documentada aquí, no requiere código): un flujo que inserta varias conexiones de golpe (varias páginas FB) puede excederse en unas pocas — el chequeo es previo a la operación, no por fila.

- [x] **Step 3: Aplicar en `posts.service.ts`**

Import:

```ts
import { assertMonthlyPostLimit } from '../payments/subscriptions.service';
```

En `createPost` (~línea 509), la variable `status` ya existe; añadir justo después de `const status = data.status ?? 'draft';`:

```ts
  // Drafts are free — the monthly limit counts scheduled/published posts
  if (status !== 'draft') await assertMonthlyPostLimit(userId);
```

En `updatePost`, justo después de `const current = await getById(id, userId);` (~línea 597):

```ts
  // Promoting a draft to scheduled/published consumes monthly quota
  if (data.status !== undefined && data.status !== 'draft' && current.status === 'draft') {
    await assertMonthlyPostLimit(userId);
  }
```

- [x] **Step 4: Verificar**

```bash
npx tsc --noEmit && npm test
```

Funcional (opcional pero recomendado): con un usuario de prueba, bajar temporalmente `postsPerMonth` de `pro` a 1 en `plans.ts`, crear un post scheduled (ok) y un segundo (→ 403 `PLAN_LIMIT_REACHED`); revertir `plans.ts`.

- [x] **Step 5: Commit**

```bash
git add src/modules/payments/subscriptions.service.ts src/modules/platforms/platforms.service.ts src/modules/posts/posts.service.ts
git commit -m "feat: enforce per-plan connection and monthly post limits"
```

---

### Task 8: Límite de IA por plan efectivo

**Files:**
- Modify: `src/modules/ai/ai.routes.ts`
- Modify: `src/modules/admin/token.service.ts`

**Interfaces:**
- Consumes: `request.subscription` (Task 3), `PLANS`, `isPlanName` (Task 2).
- Produces: `checkTokenLimit(userId: string, plan: string | null)` — firma cambia de `plan: string` a `plan: string | null`.

- [x] **Step 1: Comprobar los call sites de `checkTokenLimit`**

```bash
grep -rn "checkTokenLimit" src/
```

Expected: solo `token.service.ts` (definición) y `ai.routes.ts` (guard). Si aparece otro, adaptarlo igual que el guard.

- [x] **Step 2: `tokenLimitGuard` usa el plan efectivo**

En `ai.routes.ts`, `requireSubscription` ya corre antes (Task 3), así que `request.subscription` está poblado. Reemplazar el guard:

```ts
async function tokenLimitGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // requireSubscription ran before this hook, so subscription is populated.
  // Trial users get the trial tier's allowance instead of "no plan = unlimited".
  const plan = request.subscription?.effectivePlan ?? null;
  const { allowed, used, limit } = await checkTokenLimit(request.user.id, plan);
  if (!allowed) {
    reply.status(429).send({
      success: false,
      error: { code: 'TOKEN_LIMIT_EXCEEDED', message: 'Monthly token limit reached', used, limit },
    });
  }
}
```

Eliminar el import de `getMe` si queda sin uso en el archivo.

- [x] **Step 3: Fallback del límite en `token.service.ts`**

Reemplazar `checkTokenLimit`:

```ts
import { PLANS, isPlanName } from '../../config/plans';

export async function checkTokenLimit(
  userId: string, plan: string | null,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const [limitRows] = await pool.query<Array<{ monthly_limit: number } & RowDataPacket>>(
    'SELECT monthly_limit FROM token_limits WHERE plan = ?', [plan],
  );
  // An explicit admin-set limit wins; otherwise fall back to the plan's default.
  // A limit of 0 (explicit or absent) means unlimited — preserved semantics.
  const explicit = limitRows[0] ? Number(limitRows[0].monthly_limit) : null;
  const fallback = isPlanName(plan) ? PLANS[plan].aiTokensPerMonth : null;
  const limit    = explicit ?? fallback ?? 0;
  if (limit === 0) return { allowed: true, used: 0, limit: 0 };
  const used = await getUserMonthlyUsage(userId);
  return { allowed: used < limit, used, limit };
}
```

- [x] **Step 4: Verificar y commit**

```bash
npx tsc --noEmit && npm test
git add src/modules/ai/ai.routes.ts src/modules/admin/token.service.ts
git commit -m "feat: AI token limits fall back to plan defaults using effective plan"
```

---

### Task 9: Emails de trial + tarea cron diaria

**Files:**
- Create: `src/lib/emails/TrialEndingSoon.tsx`
- Create: `src/lib/emails/TrialExpired.tsx`
- Modify: `src/lib/email.ts`
- Modify: `src/jobs/maintenance.ts`

**Interfaces:**
- Consumes: patrón `isDue`/`markDone` y constante `DAY` de `maintenance.ts`; `send()` de `email.ts`.
- Produces: `sendTrialEndingSoonEmail(toEmail, opts: { name?: string; daysLeft: number })`, `sendTrialExpiredEmail(toEmail, opts: { name?: string })`. **Ambas lanzan si el envío falla** (a diferencia de las demás funciones de `email.ts`, que tragan el error) — el cron necesita saberlo para no marcar el flag.

- [x] **Step 1: Crear `src/lib/emails/TrialEndingSoon.tsx`**

```tsx
import * as React from 'react';
import {
  Html, Head, Body, Container, Section,
  Text, Hr, Link, Preview, Heading, Button,
} from '@react-email/components';

interface TrialEndingSoonProps {
  name?:        string;
  daysLeft:     number;
  subscribeUrl: string;
}

export function TrialEndingSoon({ name, daysLeft, subscribeUrl }: TrialEndingSoonProps) {
  const dayWord = daysLeft === 1 ? 'day' : 'days';
  return (
    <Html lang="en">
      <Head />
      <Preview>Your Vielink free trial ends in {String(daysLeft)} {dayWord}</Preview>
      <Body style={body}>
        <Container style={container}>

          <Section style={logoSection}>
            <Text style={logo}>Vielink</Text>
          </Section>

          <Hr style={hr} />

          <Section style={contentSection}>
            <Heading style={heading}>Your free trial ends in {daysLeft} {dayWord}</Heading>
            <Text style={text}>
              {name ? `Hi ${name}, ` : 'Hi, '}
              your 14-day Vielink trial is almost over. Subscribe now to keep
              publishing and scheduling to your social accounts without interruption.
            </Text>

            <Section style={buttonSection}>
              <Button href={subscribeUrl} style={button}>Choose a plan</Button>
            </Section>

            <Text style={subText}>
              After your trial ends you will still be able to sign in and manage
              your account, but publishing will be paused until you subscribe.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footerSection}>
            <Text style={footer}>
              If you&apos;d like to report an issue, reach out to{' '}
              <Link href="mailto:support@vielink.app" style={footerLink}>Vielink Support</Link>.
            </Text>
            <Text style={footer}>
              Copyright &copy; {new Date().getFullYear()} Vielink. All rights reserved.
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  margin: '0 auto',
  padding: '0 8px',
};
const container: React.CSSProperties = { maxWidth: '465px', margin: '40px auto', padding: '20px' };
const logoSection: React.CSSProperties = { marginBottom: '24px' };
const logo: React.CSSProperties = { color: '#000000', fontSize: '20px', fontWeight: 700, margin: 0, letterSpacing: '-0.5px' };
const hr: React.CSSProperties = { borderColor: '#eaeaea', margin: '0' };
const contentSection: React.CSSProperties = { padding: '32px 0' };
const heading: React.CSSProperties = { color: '#000000', fontSize: '24px', fontWeight: 400, margin: '0 0 16px', padding: 0 };
const text: React.CSSProperties = { color: '#000000', fontSize: '14px', lineHeight: '24px', margin: '0 0 24px' };
const buttonSection: React.CSSProperties = { margin: '0 0 24px', textAlign: 'center' as const };
const button: React.CSSProperties = {
  backgroundColor: '#000000',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600,
  padding: '12px 24px',
  textDecoration: 'none',
};
const subText: React.CSSProperties = { color: '#666666', fontSize: '13px', lineHeight: '22px', margin: 0 };
const footerSection: React.CSSProperties = { paddingTop: '20px' };
const footer: React.CSSProperties = { color: '#666666', fontSize: '12px', lineHeight: '20px', margin: '0 0 4px' };
const footerLink: React.CSSProperties = { color: '#666666', textDecoration: 'underline' };
```

- [x] **Step 2: Crear `src/lib/emails/TrialExpired.tsx`**

Misma estructura y estilos que `TrialEndingSoon.tsx` (copiar las constantes de estilo tal cual); cambia el componente:

```tsx
interface TrialExpiredProps {
  name?:        string;
  subscribeUrl: string;
}

export function TrialExpired({ name, subscribeUrl }: TrialExpiredProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your Vielink free trial has ended</Preview>
      <Body style={body}>
        <Container style={container}>

          <Section style={logoSection}>
            <Text style={logo}>Vielink</Text>
          </Section>

          <Hr style={hr} />

          <Section style={contentSection}>
            <Heading style={heading}>Your free trial has ended</Heading>
            <Text style={text}>
              {name ? `Hi ${name}, ` : 'Hi, '}
              your 14-day Vielink trial is over. Your account and content are
              safe, but publishing and scheduling are paused. Pick an annual
              plan to get back to work.
            </Text>

            <Section style={buttonSection}>
              <Button href={subscribeUrl} style={button}>Choose a plan</Button>
            </Section>

            <Text style={subText}>
              Everything you created during the trial will be right where you
              left it when you subscribe.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footerSection}>
            <Text style={footer}>
              If you&apos;d like to report an issue, reach out to{' '}
              <Link href="mailto:support@vielink.app" style={footerLink}>Vielink Support</Link>.
            </Text>
            <Text style={footer}>
              Copyright &copy; {new Date().getFullYear()} Vielink. All rights reserved.
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}
```

(Imports y constantes de estilo idénticos a `TrialEndingSoon.tsx`, sin `daysLeft`.)

- [x] **Step 3: Añadir senders a `src/lib/email.ts`**

Imports junto a los demás templates:

```ts
import { TrialEndingSoon } from './emails/TrialEndingSoon';
import { TrialExpired }    from './emails/TrialExpired';
```

Funciones (al final del archivo). **Nota deliberada:** no llevan try/catch — el cron decide si marca el flag según si lanzan:

```ts
// Unlike the senders above, trial emails THROW on failure: the maintenance
// cron only marks a user as notified when the send actually succeeded.
export async function sendTrialEndingSoonEmail(
  toEmail: string,
  opts: { name?: string; daysLeft: number },
): Promise<void> {
  const subscribeUrl = `${env.FRONTEND_URL}/settings`;
  const html = await render(
    React.createElement(TrialEndingSoon, { ...opts, subscribeUrl }),
  );
  const dayWord = opts.daysLeft === 1 ? 'day' : 'days';
  await send(toEmail, `Your Vielink trial ends in ${opts.daysLeft} ${dayWord}`, html);
}

export async function sendTrialExpiredEmail(
  toEmail: string,
  opts: { name?: string },
): Promise<void> {
  const subscribeUrl = `${env.FRONTEND_URL}/settings`;
  const html = await render(
    React.createElement(TrialExpired, { ...opts, subscribeUrl }),
  );
  await send(toEmail, 'Your Vielink free trial has ended', html);
}
```

- [x] **Step 4: Tarea `trial-emails` en `src/jobs/maintenance.ts`**

Import:

```ts
import { sendTrialEndingSoonEmail, sendTrialExpiredEmail } from '../lib/email';
```

Nueva sección antes de `main()`:

```ts
// ─── Task 3: trial reminder / expiry emails (daily) ──────────────────────────

interface TrialUserRow extends RowDataPacket {
  id:            string;
  email:         string;
  name:          string | null;
  trial_ends_at: Date;
}

async function sendTrialEmails(): Promise<void> {
  let reminders   = 0;
  let expirations = 0;

  // Reminder: trial ends within 3 days. plan_status = 'trialing' excludes
  // anyone who already subscribed (confirm/webhook set it to 'active').
  const [ending] = await pool.query<TrialUserRow[]>(
    `SELECT id, email, name, trial_ends_at
       FROM users
      WHERE plan_status = 'trialing'
        AND is_admin = 0
        AND email_verified = 1
        AND trial_ends_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)
        AND trial_reminder_sent = 0`,
  );
  for (const user of ending) {
    try {
      const daysLeft = Math.max(1, Math.ceil((user.trial_ends_at.getTime() - Date.now()) / DAY));
      await sendTrialEndingSoonEmail(user.email, {
        ...(user.name && { name: user.name }),
        daysLeft,
      });
      await pool.query('UPDATE users SET trial_reminder_sent = 1 WHERE id = ?', [user.id]);
      reminders++;
    } catch (err) {
      // Flag stays 0 — retried on the next daily run
      console.error(`[maintenance] trial reminder failed for ${user.id}:`, (err as Error).message);
    }
  }

  const [expired] = await pool.query<TrialUserRow[]>(
    `SELECT id, email, name, trial_ends_at
       FROM users
      WHERE plan_status = 'trialing'
        AND is_admin = 0
        AND email_verified = 1
        AND trial_ends_at < NOW()
        AND trial_expired_notified = 0`,
  );
  for (const user of expired) {
    try {
      await sendTrialExpiredEmail(user.email, {
        ...(user.name && { name: user.name }),
      });
      await pool.query('UPDATE users SET trial_expired_notified = 1 WHERE id = ?', [user.id]);
      expirations++;
    } catch (err) {
      console.error(`[maintenance] trial expiry email failed for ${user.id}:`, (err as Error).message);
    }
  }

  console.log(`[maintenance] trial emails: ${reminders} reminders, ${expirations} expirations`);
}
```

En `main()`, añadir tras el bloque de `cleanup-auth`:

```ts
    if (await isDue('trial-emails', DAY)) {
      await sendTrialEmails();
      await markDone('trial-emails');
    }
```

- [x] **Step 5: Verificar**

```bash
npx tsc --noEmit && npm test
```

Funcional: poner a un usuario de prueba `trial_ends_at = NOW() + INTERVAL 2 DAY, trial_reminder_sent = 0, plan_status = 'trialing'` y ejecutar:

```bash
npx tsx src/jobs/maintenance.ts
```

Expected: log `[maintenance] trial emails: 1 reminders, 0 expirations`, el email llega, y `trial_reminder_sent = 1` en BD. Segunda ejecución (borrar la fila `trial-emails` de `_cron_runs` primero): `0 reminders` (no duplica).

- [x] **Step 6: Commit**

```bash
git add src/lib/emails/TrialEndingSoon.tsx src/lib/emails/TrialExpired.tsx src/lib/email.ts src/jobs/maintenance.ts
git commit -m "feat: trial reminder and expiry emails via daily maintenance task"
```

---

### Task 10: Verificación end-to-end

**Files:** ninguno (solo verificación; arreglar lo que falle).

- [ ] **Step 1: Suite completa estática**

```bash
npx tsc --noEmit && npm test && npm run build
```

Expected: todo verde.

- [ ] **Step 2: Flujo completo con servidor dev**

Con `npm run dev` corriendo y un usuario de prueba recién registrado:

1. `GET /payments/subscription` → `status: "trialing"`, `trialDaysLeft: 14`, `effectivePlan: "pro"`.
2. `POST /posts` (scheduled) → 200.
3. SQL: `UPDATE users SET trial_ends_at = NOW() - INTERVAL 1 DAY WHERE email = '<test>';`
4. `POST /posts` → **402 SUBSCRIPTION_REQUIRED**. `GET /platforms`, `GET /metrics/dashboard/summary`, `POST /ai/inspire` → 402. `GET /users/me` y `GET /payments/subscription` → 200 (`status: "blocked"`).
5. Simular suscripción sin PayPal real: `UPDATE users SET plan = 'starter', plan_status = 'active' WHERE email = '<test>';` → `POST /posts` → 200; `GET /payments/subscription` → `status: "active"`, `plan: "starter"`, `limits.connections: 3`.
6. Simular cancelación con período pagado: `UPDATE users SET plan_status = 'cancelled', paid_until = NOW() + INTERVAL 200 DAY WHERE email = '<test>';` → `POST /posts` → 200; `status: "cancelled"`.
7. Período pagado vencido: `UPDATE users SET paid_until = NOW() - INTERVAL 1 DAY WHERE email = '<test>';` → `POST /posts` → **402**.

- [ ] **Step 3: Flujo PayPal sandbox (si hay credenciales configuradas)**

Crear en el dashboard sandbox de PayPal 3 planes anuales, poner sus IDs en `.env` (`PAYPAL_PLAN_ID_STARTER/PRO/ENTERPRISE`), aprobar una suscripción de prueba desde el frontend o con la API, y:

```bash
curl -s -X POST http://localhost:3000/payments/paypal/subscription \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"subscriptionId":"<I-XXXX>"}'
# Expected: {"success":true,...} y en BD plan según el plan de PayPal, plan_status='active', paid_until poblado

curl -s -X POST http://localhost:3000/payments/paypal/subscription/cancel \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"success":true,...}; en BD plan_status='cancelled', paid_until intacto, y el acceso sigue funcionando
```

Si no hay credenciales sandbox, dejar este paso documentado como pendiente para el usuario.

- [ ] **Step 4: Reportar resultados al usuario**

Resumen de qué se verificó, qué quedó pendiente (p. ej. sandbox PayPal) y recordatorio de las env vars nuevas que debe configurar en producción: `PAYPAL_PLAN_ID_STARTER`, `PAYPAL_PLAN_ID_PRO`, `PAYPAL_PLAN_ID_ENTERPRISE`.
