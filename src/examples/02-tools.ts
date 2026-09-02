/**
 * 02 — Tool calling, with your own tools.
 *
 * An agent is a loop: the model asks for a tool, you run it, you hand the
 * result back, until it answers. This is that loop with nothing hidden — read
 * it once and you can write any agent.
 *
 *   pnpm tools
 */
import { z } from 'zod'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import { DEFAULT_MODEL, openrouter } from '../lib/openrouter.js'

// --- tools: a schema for the model, a function for us ------------------------

const tools = {
  get_time: {
    description: 'The current time in a given IANA timezone.',
    schema: z.object({ timezone: z.string().describe('e.g. Asia/Kolkata') }),
    run: async ({ timezone }: { timezone: string }) =>
      new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date()),
  },
  token_price: {
    description: 'A made-up spot price for a token symbol. Replace with a real feed.',
    schema: z.object({ symbol: z.string() }),
    run: async ({ symbol }: { symbol: string }) => ({ symbol, usd: symbol === 'ORBIO' ? 0.01 : 1 }),
  },
} as const

type ToolName = keyof typeof tools

const toolDefinitions: ChatCompletionTool[] = Object.entries(tools).map(([name, tool]) => ({
  type: 'function',
  function: { name, description: tool.description, parameters: z.toJSONSchema(tool.schema) },
}))

// --- the loop ---------------------------------------------------------------

const messages: ChatCompletionMessageParam[] = [
  { role: 'system', content: 'Use tools when they help. Answer briefly.' },
  { role: 'user', content: process.argv.slice(2).join(' ') || 'What time is it in Mumbai, and what is ORBIO worth?' },
]

for (let step = 0; step < 6; step++) {
  const completion = await openrouter.chat.completions.create({
    model: DEFAULT_MODEL,
    messages,
    tools: toolDefinitions,
  })
  const message = completion.choices[0].message
  messages.push(message)

  if (!message.tool_calls?.length) {
    console.log(message.content)
    break
  }

  for (const call of message.tool_calls) {
    if (call.type !== 'function') continue
    const name = call.function.name as ToolName
    const tool = tools[name]
    const args = tool.schema.parse(JSON.parse(call.function.arguments || '{}'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await tool.run(args as any)
    console.log(`→ ${name}(${JSON.stringify(args)}) = ${JSON.stringify(result)}`)
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
  }
}
