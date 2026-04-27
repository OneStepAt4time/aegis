{{/*
Expand the name of the chart.
*/}}
{{- define "aegis.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "aegis.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "aegis.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart label value.
*/}}
{{- define "aegis.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{/*
Common selector labels.
*/}}
{{- define "aegis.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aegis.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Common labels applied to every resource.
*/}}
{{- define "aegis.labels" -}}
helm.sh/chart: {{ include "aegis.chart" . }}
{{ include "aegis.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
ServiceAccount name.
*/}}
{{- define "aegis.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "aegis.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Headless Service name (for StatefulSet network identity).
*/}}
{{- define "aegis.headlessServiceName" -}}
{{- printf "%s-headless" (include "aegis.fullname" .) -}}
{{- end -}}

{{/*
Container image reference.
*/}}
{{- define "aegis.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{/*
State volume name.
*/}}
{{- define "aegis.stateVolumeName" -}}data{{- end -}}

{{/*
Auth Secret name.
*/}}
{{- define "aegis.authSecretName" -}}
{{- if .Values.auth.existingSecret -}}
{{- .Values.auth.existingSecret -}}
{{- else -}}
{{- printf "%s-auth" (include "aegis.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
ConfigMap name.
*/}}
{{- define "aegis.configMapName" -}}
{{- printf "%s-config" (include "aegis.fullname" .) -}}
{{- end -}}

{{/*
Validation: enforce single-replica and sane persistence config.
*/}}
{{- define "aegis.validate" -}}
{{- if ne (int .Values.replicaCount) 1 -}}
{{- fail "Aegis currently supports replicaCount=1 only because session state is local to the pod." -}}
{{- end -}}
{{- if and (not .Values.persistence.enabled) .Values.persistence.existingClaim -}}
{{- fail "persistence.existingClaim requires persistence.enabled=true." -}}
{{- end -}}
{{- end -}}
