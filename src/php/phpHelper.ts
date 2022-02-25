import * as php from "php-parser";
import * as vscode from "vscode";

import { getFunctionDefinition, ParameterPosition, removeShebang, showVariadicNumbers } from "../utils";
import PHPConfiguration from "./phpConfiguration";

export default class PHPHelper {
  static parse(code: string): ParameterPosition[][] {
    const parameters: ParameterPosition[][] = [];
    const parser = new php.Engine({
      parser: {
        extractDoc: true,
        php7: true,
        locations: true,
        suppressErrors: true,
      },
      ast: {
        all_tokens: true,
        withPositions: true,
      },
    });

    code = removeShebang(code).replace("<?php", "");
    const ast: any = parser.parseEval(code);
    const functionCalls: any[] = this.crawlAST(ast);

    functionCalls.forEach((expression) => {
      parameters.push(this.getParametersFromExpression(expression));
    });

    return parameters;
  }

  static crawlAST(ast: any, functionCalls = []): any[] {
    const canAcceptArguments = ast.kind && (ast.kind === "call" || ast.kind === "new");
    const hasArguments = ast.arguments && ast.arguments.length > 0;
    const shouldHideArgumentNames = vscode.workspace.getConfiguration("inline-parameters").get("hideSingleParameters")
      && ast.arguments && ast.arguments.length === 1;

    if (canAcceptArguments && hasArguments && !shouldHideArgumentNames) {
      functionCalls.push(ast);
    }

    for (const [, value] of Object.entries(ast)) {
      if (value instanceof Object) {
        functionCalls = this.crawlAST(value, functionCalls);
      }
    }

    return functionCalls;
  }

  static getParametersFromExpression(expression: any): ParameterPosition[] | undefined {
    const parameters = [];
    if (!expression.arguments) {
      return undefined;
    }

    expression.arguments.forEach((argument: any, key: number) => {
      if (!expression.what || (!expression.what.offset && !expression.what.loc)) {
        return;
      }

      const expressionLoc = expression.what.offset ? expression.what.offset.loc.start : expression.what.loc.end;
      parameters.push({
        namedValue: argument.name ?? null,
        expression: {
          line: parseInt(expressionLoc.line) - 1,
          character: parseInt(expressionLoc.column),
        },
        key: key,
        start: {
          line: parseInt(argument.loc.start.line) - 1,
          character: parseInt(argument.loc.start.column),
        },
        end: {
          line: parseInt(argument.loc.end.line) - 1,
          character: parseInt(argument.loc.end.column),
        },
      });
    });

    return parameters;
  }

  static async getParameterNames(uri: vscode.Uri, languageParameters: ParameterPosition[]): Promise<string[]> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      let isVariadic = false;
      let parameters: any[];
      const firstParameter = languageParameters[0];

      const description: any = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        uri,
        new vscode.Position(
          firstParameter.expression.line,
          firstParameter.expression.character
        )
      );

      if (description && description.length > 0) {
        try {
          const regEx = /(?<=@param.+)(\.{3})?(\$[a-zA-Z0-9_]+)/g;
          parameters = getFunctionDefinition(<vscode.MarkdownString[]>description[0].contents)?.match(regEx);
        } catch (error) {
          console.error(error);
        }
      }

      if (!parameters) {
        return reject();
      }

      parameters = parameters.map((parameter: any) => {
        if (parameter.startsWith("...")) {
          isVariadic = true;
          parameter = parameter.slice(3);
        }

        return parameter;
      });

      let namedValueName = undefined;
      const parametersLength = parameters.length;
      const suppressWhenArgumentMatchesName = PHPConfiguration.suppressWhenArgumentMatchesName();
      for (let i = 0; i < languageParameters.length; i++) {
        const parameter = languageParameters[i];
        const key = parameter.key;

        if (isVariadic && key >= parameters.length - 1) {
          if (namedValueName === undefined) namedValueName = parameters[parameters.length - 1];

          if (suppressWhenArgumentMatchesName && namedValueName.replace("$", "") === parameter.namedValue) {
            return reject();
          }

          let name = namedValueName;
          name = PHPHelper.showDollarSign(name);
          parameters[i] = showVariadicNumbers(name, -parametersLength + 1 + key);
          continue;
        }

        if (parameters[key]) {
          let name = parameters[key];

          if (suppressWhenArgumentMatchesName && name.replace("$", "") === parameter.namedValue) {
            parameters[i] = undefined;
            continue;
          }

          name = PHPHelper.showDollarSign(name);
          parameters[i] = name;
          continue;
        }

        parameters[i] = undefined;
        continue;
      }

      return resolve(parameters);
    });
  }

  static showDollarSign(str: string): string {
    if (PHPConfiguration.showDollarSign()) {
      return str;
    }

    return str.replace("$", "");
  }
}
