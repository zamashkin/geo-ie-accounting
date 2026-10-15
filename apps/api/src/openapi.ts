import { MinorUnitsString } from '@ie-ledger/contracts';
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

// Responses are documented from the Zod *output* type (fastify-type-provider-zod v7). Money is a
// bigint in code and a string on the wire (MinorUnits codec), and JSON Schema cannot express a
// bigint, so every bigint node is documented as the integer string it is encoded to.
// Passing an override replaces the library's default one, so its two rules (dates as date-time
// strings, z.undefined() as null) are kept here. Both describe the JSON on the wire, which is
// the same for requests and responses.

const { $schema: _ignored, ...minorUnitsJsonSchema } = z.toJSONSchema(MinorUnitsString);

interface OverrideContext {
  zodSchema: { _zod: { def: { type: string } } };
  jsonSchema: Record<string, unknown>;
}

function override(ctx: OverrideContext) {
  switch (ctx.zodSchema._zod.def.type) {
    case 'bigint':
      Object.assign(ctx.jsonSchema, minorUnitsJsonSchema);
      break;
    case 'date':
      Object.assign(ctx.jsonSchema, { type: 'string', format: 'date-time' });
      break;
    case 'undefined':
      ctx.jsonSchema.type = 'null';
      break;
  }
}

const zodToJsonConfig = { override };

export const jsonSchemaTransform = createJsonSchemaTransform({ zodToJsonConfig });
export const jsonSchemaTransformObject = createJsonSchemaTransformObject({ zodToJsonConfig });
