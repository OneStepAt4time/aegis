{{- define "aegis.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

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

{{- define "aegis.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "aegis.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aegis.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "aegis.labels" -}}
helm.sh/chart: {{ include "aegis.chart" . }}
{{ include "aegis.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "aegis.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "aegis.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "aegis.headlessServiceName" -}}
{{- printf "%s-headless" (include "aegis.fullname" .) -}}
{{- end -}}

{{- define "aegis.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{- define "aegis.stateVolumeName" -}}data{{- end -}}

{{- define "aegis.authSecretName" -}}
{{- if .Values.auth.existingSecret -}}
{{- .Values.auth.existingSecret -}}
{{- else -}}
{{- printf "%s-auth" (include "aegis.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "aegis.validate" -}}
{{- if ne (int .Values.replicaCount) 1 -}}
{{- fail "Aegis currently supports replicaCount=1 only because session state is local to the pod." -}}
{{- end -}}
{{- if and (not .Values.persistence.enabled) .Values.persistence.existingClaim -}}
{{- fail "persistence.existingClaim requires persistence.enabled=true." -}}
{{- end -}}
{{- end -}}
