import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as random from "@pulumi/random";

import { createApiClient } from "@neondatabase/api-client";
import { hostname } from "os";
import { getConnectionString } from "./neon-connection-string";

const cfg = new pulumi.Config();

const baseUrl = cfg.get("baseUrl") ?? `http://${hostname()}`
const neonApiToken = cfg.require("neonApiToken")
const hasuraSecretKey = cfg.requireSecret("hasuraSecretKey")
const neonProjectName = cfg.require("neonProjectName")
const databaseName = cfg.require("databaseName")

export = async () => {
	const api = createApiClient({ apiKey: neonApiToken })
	const projectInfo = (await api.listProjects({limit: 400})).data.projects.find(x => x.name === neonProjectName)

	if (!projectInfo) { 
		throw new Error(`Project ${neonProjectName} not found`)
	}

	const branches = await api.listProjectBranches(projectInfo.id)
	const hasuraImage = new docker.RemoteImage("hasura-image", {name: "hasura/graphql-engine:v2.42.0"})

	const connStrings: Record<string, string> = {}
	for (const branch of branches.data.branches) {
		connStrings[branch.name] = await getConnectionString(api, projectInfo.id, branch.id, databaseName, false, "require", cfg.get("neonRoleName"))
	}

	const containers: Record<string, docker.Container> = {}
	for (const branch of branches.data.branches) {
		const port = new random.RandomInteger(`hasura-port-${branch.name}`, {
      min: 32768,
      max: 65535,
    });

		const connString = connStrings[branch.name]

		containers[branch.name] = new docker.Container(`hasura-${branch.name}`, {
			image: hasuraImage.repoDigest,
			name: `hasura-${branch.name}`,
			ports: [{ internal: 8080, external: port.result }],
			networkMode: "bridge",
			envs: [
				`HASURA_GRAPHQL_DATABASE_URL=${connString}`,
				`HASURA_GRAPHQL_ENABLE_CONSOLE=true`,
				hasuraSecretKey.apply(s => `HASURA_GRAPHQL_ADMIN_SECRET=${s}`)
			],
			start: true
		}, { ignoreChanges: ["image"] })
	}

	return Object.keys(containers).reduce((acc, x) => {
		acc[`${x}-endpoint`] = containers[x].ports.apply(p => `${baseUrl}:${p!![0].external}`)
		acc[`${x}-containerId`] = containers[x].id

		return acc;
	}, {} as Record<string, any>)
}