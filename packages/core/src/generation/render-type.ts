import type { Schema, SchemaAST } from 'effect';

/**
 * Renders a schema as TypeScript declarations for the system prompt. Nodes annotated with an
 * `identifier` become named `type` declarations, emitted dependencies first; `description`
 * annotations become doc comments. Only literals, strings, structs, unions and arrays are
 * supported, and anything else throws: the output contract must never be guessed.
 */
export const renderTypeScript = (schema: Schema.Top): string => {
  const declarations: Array<string> = [];
  const declared = new Set<string>();

  const reference = (ast: SchemaAST.AST): string => {
    const identifier = ast.annotations?.['identifier'];
    if (typeof identifier !== 'string') return body(ast);
    if (!declared.has(identifier)) {
      declared.add(identifier);
      const comment = docComment(description(ast), '');
      declarations.push(`${comment}type ${identifier} = ${body(ast)};`);
    }
    return identifier;
  };

  const body = (ast: SchemaAST.AST): string => {
    if (ast.encoding !== undefined) return unsupported(`${ast._tag} with an encoding`);
    switch (ast._tag) {
      case 'String':
        return 'string';
      case 'Literal':
        if (typeof ast.literal === 'bigint') return unsupported('bigint literal');
        return JSON.stringify(ast.literal);
      case 'Union':
        return ast.types.map(reference).join(' | ');
      case 'Arrays': {
        const [element] = ast.rest;
        if (ast.elements.length > 0 || ast.rest.length !== 1 || element === undefined) {
          return unsupported('tuple');
        }
        const rendered = reference(element);
        return rendered.includes('|') ? `(${rendered})[]` : `${rendered}[]`;
      }
      case 'Objects': {
        if (ast.indexSignatures.length > 0) return unsupported('index signature');
        const properties = ast.propertySignatures.map((property) => {
          if (typeof property.name !== 'string') return unsupported('non-string property key');
          const optional = property.type.context?.isOptional === true ? '?' : '';
          const comment = docComment(description(property.type), '  ');
          const value = reference(property.type).replaceAll('\n', '\n  ');
          return `${comment}  ${property.name}${optional}: ${value};`;
        });
        return `{\n${properties.join('\n')}\n}`;
      }
      default:
        return unsupported(ast._tag);
    }
  };

  reference(schema.ast);
  return declarations.join('\n\n');
};

/**
 * The node's description. Annotating a schema that has checks (such as `NonEmptyString`) stores the
 * annotation on its last check, so that is read too.
 */
const description = (ast: SchemaAST.AST): unknown =>
  ast.annotations?.['description'] ?? ast.checks?.at(-1)?.annotations?.['description'];

const docComment = (text: unknown, indent: string): string =>
  typeof text === 'string' ? `${indent}/** ${text} */\n` : '';

const unsupported = (shape: string): never => {
  throw new Error(`renderTypeScript does not support ${shape} schemas`);
};
