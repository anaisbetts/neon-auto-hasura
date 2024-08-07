import { Api, EndpointType } from "@neondatabase/api-client";

export async function getConnectionString(
	apiClient: Api<unknown>,
	projectId: string,
	branchId: string,
	databaseName: string,
	pooled: boolean,
	ssl: string,
	roleName?: string,
	endpointType?: EndpointType,
) {
  const {
    data: { endpoints },
  } = await apiClient.listProjectBranchEndpoints(projectId, branchId);
  const matchEndpointType = endpointType ?? EndpointType.ReadWrite;

  let endpoint = endpoints.find((e) => e.type === matchEndpointType);

  if (!endpoint && endpointType == null) {
    endpoint = endpoints[0];
  }

  if (!endpoint) {
    throw new Error(
      `No ${
        endpointType ?? ""
      } endpoint found for the branch: ${branchId}`
    );
  }

  const role = roleName ??
    (await apiClient
      .listProjectBranchRoles(projectId, branchId)
      .then(({ data }) => {
        if (data.roles.length === 0) {
          throw new Error(`No roles found for the branch: ${branchId}`);
        }
        if (data.roles.length === 1) {
          return data.roles[0].name;
        }
        throw new Error(
          `Multiple roles found for the branch, please provide one with the --role-name option: ${data.roles
            .map((r) => r.name)
            .join(", ")}`
        );
      }));

  const {
    data: { databases: branchDatabases },
  } = await apiClient.listProjectBranchDatabases(projectId, branchId);

  const database = databaseName ??
    (() => {
      if (branchDatabases.length === 0) {
        throw new Error(`No databases found for the branch: ${branchId}`);
      }
      if (branchDatabases.length === 1) {
        return branchDatabases[0].name;
      }
      throw new Error(
        `Multiple databases found for the branch, please provide one with the --database-name option: ${branchDatabases
          .map((d) => d.name)
          .join(", ")}`
      );
    })();

  if (!branchDatabases.find((d) => d.name === database)) {
    throw new Error(`Database not found: ${database}`);
  }

  const { data: { password }, } = await apiClient.getProjectBranchRolePassword(
    projectId,
    endpoint.branch_id,
    role!!
  );

  let host = pooled
    ? endpoint.host.replace(endpoint.id, `${endpoint.id}-pooler`)
    : endpoint.host;

  const connectionString = new URL(`postgresql://${host}`);
  connectionString.pathname = database;
  connectionString.username = role!!;
  connectionString.password = password;

  if (ssl !== "omit") {
    connectionString.searchParams.set("sslmode", ssl);
  }

	return connectionString.toString();
};
