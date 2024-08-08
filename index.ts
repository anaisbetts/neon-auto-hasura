import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as random from "@pulumi/random";

import { Api, createApiClient } from "@neondatabase/api-client";
import { hostname } from "os";
import { connectionStringsForBranches, getConnectionString } from "./neon";

const cfg = new pulumi.Config();

const baseUrl = cfg.get("baseUrl") ?? `http://${hostname()}`
const neonApiToken = cfg.require("neonApiToken")
const hasuraSecretKey = cfg.requireSecret("hasuraSecretKey")
const neonProjectName = cfg.require("neonProjectName")
const databaseName = cfg.require("databaseName")


export = async () => {
	const api = createApiClient({ apiKey: neonApiToken })
	const hasuraImage = new docker.RemoteImage("hasura-image", {name: "hasura/graphql-engine:v2.42.0"})

	const connStrings = await connectionStringsForBranches(api, neonProjectName, databaseName, cfg.get("neonRoleName"))

	const containers: Record<string, docker.Container> = {}
	for (const branch of Object.keys(connStrings)) {
		const port = new random.RandomInteger(`hasura-port-${branch}`, {
      min: 32768,
      max: 65535,
    });

		const connString = connStrings[branch]

		containers[branch] = new docker.Container(`hasura-${branch}`, {
			image: hasuraImage.repoDigest,
			name: `hasura-${branch}`,
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