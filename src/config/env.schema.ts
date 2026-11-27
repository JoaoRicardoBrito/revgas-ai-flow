import { z } from 'zod';

/**
 * Variáveis de ambiente aceitas pela aplicação.
 *
 * Chaves que só serão usadas em issues futuras (Groq, banco, WhatsApp) são
 * opcionais aqui; cada módulo passa a exigi-las quando for implementado.
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Minutos sem mensagem até a sessão expirar (abandono). */
    CONVERSATION_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(30),

    REVGAS_API_BASE_URL: z.url().default('https://api.revgas.com/v1'),
    REVGAS_API_KEY: z.string().optional(),
    REVGAS_USE_MOCK: z.stringbool().default(true),
    /** A nota fiscal exige CPF de cliente novo. Na NFC-e é opcional. */
    CPF_REQUIRED: z.stringbool().default(false),
    /** Revenda (estabelecimento) usada em produtos, pagamentos e vendas. */
    REVGAS_ESTABLISHMENT_ID: z.coerce.number().int().positive().optional(),

    GROQ_API_KEY: z.string().optional(),
    GROQ_MODEL: z.string().optional(),

    DATABASE_URL: z.url().optional(),

    WHATSAPP_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  })
  .superRefine(
    (env, ctx) => {
      // Com `when`, o valor pode ser o texto cru se a conversão falhou.
      // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare
      if (env.REVGAS_USE_MOCK === false && !env.REVGAS_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['REVGAS_API_KEY'],
          message: 'obrigatória quando REVGAS_USE_MOCK=false',
        });
      }
      // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare
      if (env.REVGAS_USE_MOCK === false && !env.REVGAS_ESTABLISHMENT_ID) {
        ctx.addIssue({
          code: 'custom',
          path: ['REVGAS_ESTABLISHMENT_ID'],
          message: 'obrigatório quando REVGAS_USE_MOCK=false',
        });
      }

      const whatsappKeys = [
        'WHATSAPP_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_VERIFY_TOKEN',
      ] as const;
      const filled = whatsappKeys.filter((key) => env[key] !== undefined);
      if (filled.length > 0 && filled.length < whatsappKeys.length) {
        for (const key of whatsappKeys.filter((k) => !filled.includes(k))) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message:
              'o canal WhatsApp exige WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_VERIFY_TOKEN juntos',
          });
        }
      }
    },
    // Roda mesmo se outro campo falhou, para listar todos os erros de uma vez.
    { when: () => true },
  );

export type Env = z.infer<typeof envSchema>;

/**
 * Valida o ambiente na subida. Linhas vazias do `.env` (`CHAVE=`) contam como
 * ausentes. A mensagem de erro cita só o nome da variável, nunca o valor,
 * para não vazar segredos em log.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(
      ([, value]) => !(typeof value === 'string' && value.trim() === ''),
    ),
  );

  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`,
    );
    throw new Error(`Configuração inválida no ambiente:\n${lines.join('\n')}`);
  }
  return result.data;
}
