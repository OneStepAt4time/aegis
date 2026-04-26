# Aegis Helm Chart

Deploys [Aegis](https://github.com/OneStepAt4time/aegis) — the control plane for Claude Code — on Kubernetes.

## Prerequisites

- Kubernetes 1.25+
- Helm 3.8+

## Install

```bash
helm repo add aegis https://onestepat4time.github.io/aegis
helm install aegis aegis/aegis \
  --namespace aegis \
  --create-namespace \
  --set auth.token="your-secret-token"
```

Or from a local checkout:

```bash
helm install aegis ./charts/aegis \
  --namespace aegis \
  --create-namespace \
  --set auth.token="your-secret-token"
```

## Upgrade

```bash
helm upgrade aegis ./charts/aegis \
  --namespace aegis \
  --reuse-values \
  --set image.tag="0.7.0"
```

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `replicaCount` | int | `1` | Number of replicas (must be 1 — local state) |
| `image.repository` | string | `ghcr.io/onestepat4time/aegis` | Container image repository |
| `image.tag` | string | `""` (uses `appVersion`) | Container image tag |
| `image.pullPolicy` | string | `IfNotPresent` | Image pull policy |
| `aegis.host` | string | `"0.0.0.0"` | Bind address (`AEGIS_HOST`) |
| `aegis.port` | int | `9100` | HTTP port (`AEGIS_PORT`) |
| `aegis.tmuxSession` | string | `"aegis"` | tmux session prefix (`AEGIS_TMUX_SESSION`) |
| `aegis.stateDir` | string | `/var/lib/aegis` | State dir mounted from PVC (`AEGIS_STATE_DIR`) |
| `aegis.extraEnv` | list | `[]` | Additional env vars (`{name, value}` or `{name, valueFrom}`) |
| `aegis.extraEnvFrom` | list | `[]` | Additional `envFrom` entries |
| `auth.token` | string | `""` | Inline API token stored in a generated Secret |
| `auth.existingSecret` | string | `""` | Existing Secret name (overrides `auth.token`) |
| `auth.existingSecretKey` | string | `AEGIS_AUTH_TOKEN` | Key inside the Secret |
| `serviceAccount.create` | bool | `true` | Create a dedicated ServiceAccount |
| `serviceAccount.name` | string | `""` | Override ServiceAccount name |
| `serviceAccount.annotations` | object | `{}` | ServiceAccount annotations |
| `service.type` | string | `ClusterIP` | Service type |
| `service.port` | int | `9100` | Service port |
| `service.portName` | string | `"http"` | Named port |
| `ingress.enabled` | bool | `false` | Create an Ingress resource |
| `ingress.className` | string | `"nginx"` | Ingress class name |
| `ingress.annotations` | object | `{}` | Ingress annotations |
| `ingress.hosts` | list | `[aegis.local]` | Host/path rules |
| `ingress.tls` | list | `[]` | TLS configuration |
| `persistence.enabled` | bool | `true` | Enable persistent storage |
| `persistence.size` | string | `1Gi` | PVC storage size |
| `persistence.storageClass` | string | `""` | StorageClass (cluster default if empty) |
| `persistence.accessModes` | list | `["ReadWriteOnce"]` | PVC access modes |
| `persistence.existingClaim` | string | `""` | Use an existing PVC |
| `configMap.enabled` | bool | `false` | Create a ConfigMap for env vars |
| `configMap.data` | object | `{}` | ConfigMap key-value pairs |
| `probes.path` | string | `/v1/health` | Health check HTTP path |
| `probes.liveness.*` | object | see values | Liveness probe tuning |
| `probes.readiness.*` | object | see values | Readiness probe tuning |
| `resources` | object | `{}` | Pod resource requests/limits |
| `autoscaling.enabled` | bool | `false` | Create an HPA (not yet supported >1 replica) |
| `autoscaling.minReplicas` | int | `1` | HPA minimum replicas |
| `autoscaling.maxReplicas` | int | `3` | HPA maximum replicas |
| `autoscaling.targetCPUUtilizationPercentage` | int | `80` | HPA CPU target |
| `nodeSelector` | object | `{}` | Node selector labels |
| `tolerations` | list | `[]` | Pod tolerations |
| `affinity` | object | `{}` | Pod affinity rules |
| `extraVolumes` | list | `[]` | Additional pod volumes |
| `extraVolumeMounts` | list | `[]` | Additional container volume mounts |
| `terminationGracePeriodSeconds` | int | `30` | Pod termination grace period |

## Examples

### Minimal install with auth

```bash
helm install aegis ./charts/aegis \
  --set auth.token="s3cret" \
  --set persistence.size=5Gi
```

### With nginx Ingress and TLS

```bash
helm install aegis ./charts/aegis \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set 'ingress.hosts[0].host=aegis.example.com' \
  --set 'ingress.tls[0].secretName=aegis-tls' \
  --set 'ingress.tls[0].hosts[0]=aegis.example.com' \
  --set ingress.annotations.cert-manager\.io/cluster-issuer=letsencrypt-prod
```

### Using an existing Secret for auth

```bash
helm install aegis ./charts/aegis \
  --set auth.existingSecret=my-aegis-secret \
  --set auth.existingSecretKey=AUTH_TOKEN
```

### Injecting Claude auth via extraVolumes

```bash
helm install aegis ./charts/aegis \
  --set 'extraVolumes[0].name=claude-auth' \
  --set 'extraVolumes[0].secret.secretName=claude-auth-secret' \
  --set 'extraVolumeMounts[0].name=claude-auth' \
  --set 'extraVolumeMounts[0].mountPath=/home/aegis/.claude'
```

### Resource limits

```bash
helm install aegis ./charts/aegis \
  --set 'resources.requests.cpu=250m' \
  --set 'resources.requests.memory=256Mi' \
  --set 'resources.limits.cpu=1' \
  --set 'resources.limits.memory=512Mi'
```

## Architecture notes

- Aegis runs as a **StatefulSet** because session state is stored on local disk.
- The chart enforces `replicaCount: 1` via a validation helper. Scaling beyond
  1 replica requires external state storage (planned for a future phase).
- A headless Service provides stable network identity for the StatefulSet.
- The HPA template is included for forward-compatibility but is disabled by default.
