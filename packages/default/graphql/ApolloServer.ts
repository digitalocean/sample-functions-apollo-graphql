import { ApolloServerBase, GraphQLOptions, isHttpQueryError, runHttpQuery } from 'apollo-server-core';
import type { LandingPage } from 'apollo-server-plugin-base';
import { Headers } from 'apollo-server-env';

function sanitizeHeaders(headers: { [key: string]: any } = {}) {
  return Object.entries(headers)
  .reduce((acc, [key, value]) => {
    acc[key.toLowerCase()] = value;
    return acc;
  }, {} as { [key: string]: any })
}

export interface CreateHandlerOptions {
  /**
   * Response headers
   *
   * @type {{ [key: string]: any }}
   * @memberof CreateHandlerOptions
   */
  headers: { [key: string]: any }
}

export interface MainArgs {
  __ow_headers?: { [k: string]: any }
  __ow_path?: string
  __ow_method?: string
  __ow_body?: string | object | Record<string, any>
  __ow_query?: string
  [key: string]: any
}
type OwMainHandler = (args: MainArgs) => Promise<any>

export class ApolloServer extends ApolloServerBase<{ args: MainArgs }> {
  protected override serverlessFramework(): boolean {
    return true;
  }

  createGraphQLServerOptions(args: MainArgs): Promise<GraphQLOptions> {
    return super.graphQLServerOptions({ args });
  }

  public createHandler(
    options?: CreateHandlerOptions,
  ): OwMainHandler {

    let landingPage: LandingPage | null | undefined;

    return async (args = {}) => {
      await this.ensureStarted();

      if (landingPage === undefined) {
        landingPage = this.getLandingPage();
      }

      const requestHeaders = sanitizeHeaders(args.__ow_headers);
      const responseHeaders = sanitizeHeaders(options?.headers ?? {})


      if (args.__ow_method === 'options') {
        if (
          requestHeaders['access-control-request-headers'] &&
          !responseHeaders['access-control-allow-headers']
        ) {
          responseHeaders['access-control-Allow-headers'] = requestHeaders['access-control-request-headers'];
          responseHeaders['vary'] = 'access-control-Request-headers';
        }

        if (
          requestHeaders['access-control-request-method'] &&
          !responseHeaders['access-control-allow-methods']
        ) {
          responseHeaders['access-control-allow-methods'] = requestHeaders['access-control-request-method'];
        }
        return {
          body: '',
          statusCode: 204,
          headers: responseHeaders,
        }
      }

      if (
        landingPage &&
        args.__ow_method === 'get' &&
        requestHeaders['accept']?.includes('text/html')
      ) {
        return {
          body: landingPage.html,
          statusCode: 200,
          headers: {
            'Content-Type': 'text/html',
            ...responseHeaders
          },
        }
      }

      const graphQLOptions = await this.createGraphQLServerOptions(args)
      return this.graphQLHandler(args, graphQLOptions, responseHeaders)
    };
  }

  private async graphQLHandler(args: MainArgs, options: GraphQLOptions, responseHeaders: CreateHandlerOptions['headers']) {
    const method = args.__ow_method.toUpperCase();
    if (method === 'POST' && !args) {
      return {
        body: 'POST body missing.',
        statusCode: 400,
        headers: responseHeaders
      }
    }

    try {
      const { graphqlResponse, responseInit } = await runHttpQuery([args], {
        method: method,
        options: options,
        query: args,
        request: {
          url: args.__ow_path,
          method: method,
          headers: new Headers({
            ...sanitizeHeaders(args.__ow_headers),
            ...responseHeaders
          }),
        },
      })

      return {
        body: graphqlResponse,
        statusCode: responseInit.status || 200,
        headers: {
          ...sanitizeHeaders(responseInit.headers),
          ...responseHeaders
        },
      }
    } catch (error) {
      if (isHttpQueryError(error)) {
        return {
          body: {
            error,
          },
          statusCode: error.statusCode,
          headers: {
            ...sanitizeHeaders(error.headers),
            ...responseHeaders
          },
        }
      } else {
        return {
          body: error,
          statusCode: 400
        }
      }
    }
  }
}