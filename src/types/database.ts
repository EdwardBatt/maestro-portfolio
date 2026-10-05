export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accountability_profiles: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          id: string
          kind: string
          name: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          name: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountability_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_feedback: {
        Row: {
          app_version: string | null
          category: Database["public"]["Enums"]["feedback_category"]
          created_at: string
          created_by: string | null
          id: string
          message: string
          page_path: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["feedback_status"]
          submitted_by: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          app_version?: string | null
          category?: Database["public"]["Enums"]["feedback_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          message: string
          page_path?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          submitted_by: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          app_version?: string | null
          category?: Database["public"]["Enums"]["feedback_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string
          page_path?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          submitted_by?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_feedback_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_feedback_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_feedback_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string
          key: string
          value: string
        }
        Insert: {
          created_at?: string
          key: string
          value: string
        }
        Update: {
          created_at?: string
          key?: string
          value?: string
        }
        Relationships: []
      }
      asset_folders: {
        Row: {
          brand_id: string | null
          campaign_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          deliverable_id: string | null
          id: string
          is_system: boolean
          kind: string
          name: string
          parent_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          brand_id?: string | null
          campaign_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          deliverable_id?: string | null
          id?: string
          is_system?: boolean
          kind?: string
          name: string
          parent_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          brand_id?: string | null
          campaign_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          deliverable_id?: string | null
          id?: string
          is_system?: boolean
          kind?: string
          name?: string
          parent_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_folders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_folders_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_folders_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_folders_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "asset_folders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_folders_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_folders_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "asset_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "asset_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_folders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_references: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string | null
          id: string
          ref_id: string
          ref_type: string
          tenant_id: string
          updated_by: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          ref_id: string
          ref_type: string
          tenant_id: string
          updated_by?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          ref_id?: string
          ref_type?: string
          tenant_id?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_references_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_references_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_versions: {
        Row: {
          archive_ref: string | null
          archived_at: string | null
          asset_id: string
          content_type: string | null
          created_at: string
          created_by: string | null
          duration_seconds: number | null
          id: string
          link_url: string | null
          note: string | null
          object_key: string | null
          size_bytes: number | null
          tenant_id: string
          thumb_object_key: string | null
          updated_by: string | null
          uploaded_by: string | null
          version: number
        }
        Insert: {
          archive_ref?: string | null
          archived_at?: string | null
          asset_id: string
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          id?: string
          link_url?: string | null
          note?: string | null
          object_key?: string | null
          size_bytes?: number | null
          tenant_id: string
          thumb_object_key?: string | null
          updated_by?: string | null
          uploaded_by?: string | null
          version: number
        }
        Update: {
          archive_ref?: string | null
          archived_at?: string | null
          asset_id?: string
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          id?: string
          link_url?: string | null
          note?: string | null
          object_key?: string | null
          size_bytes?: number | null
          tenant_id?: string
          thumb_object_key?: string | null
          updated_by?: string | null
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_versions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_versions_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          archived_at: string | null
          brought_back_until: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          current_version: number
          deleted_at: string | null
          deleted_by: string | null
          deliverable_id: string | null
          duration_seconds: number | null
          folder_id: string
          id: string
          is_final: boolean
          is_proof: boolean
          is_source: boolean
          link_expires_on: string | null
          link_expiry_notified_at: string | null
          link_url: string | null
          name: string
          object_key: string | null
          provider: string
          retention_state: string
          size_bytes: number | null
          storage_tier: string
          tenant_id: string
          thumb_object_key: string | null
          updated_at: string
          updated_by: string | null
          uploaded_by: string | null
        }
        Insert: {
          archived_at?: string | null
          brought_back_until?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          current_version?: number
          deleted_at?: string | null
          deleted_by?: string | null
          deliverable_id?: string | null
          duration_seconds?: number | null
          folder_id: string
          id?: string
          is_final?: boolean
          is_proof?: boolean
          is_source?: boolean
          link_expires_on?: string | null
          link_expiry_notified_at?: string | null
          link_url?: string | null
          name: string
          object_key?: string | null
          provider?: string
          retention_state?: string
          size_bytes?: number | null
          storage_tier?: string
          tenant_id: string
          thumb_object_key?: string | null
          updated_at?: string
          updated_by?: string | null
          uploaded_by?: string | null
        }
        Update: {
          archived_at?: string | null
          brought_back_until?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          current_version?: number
          deleted_at?: string | null
          deleted_by?: string | null
          deliverable_id?: string | null
          duration_seconds?: number | null
          folder_id?: string
          id?: string
          is_final?: boolean
          is_proof?: boolean
          is_source?: boolean
          link_expires_on?: string | null
          link_expiry_notified_at?: string | null
          link_url?: string | null
          name?: string
          object_key?: string | null
          provider?: string
          retention_state?: string
          size_bytes?: number | null
          storage_tier?: string
          tenant_id?: string
          thumb_object_key?: string | null
          updated_at?: string
          updated_by?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "assets_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "asset_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_days: {
        Row: {
          check_in_source: string | null
          check_out_source: string | null
          checked_in_at: string | null
          checked_out_at: string | null
          created_at: string
          created_by: string | null
          id: string
          last_activity_at: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
          work_date: string
          worked_minutes: number | null
        }
        Insert: {
          check_in_source?: string | null
          check_out_source?: string | null
          checked_in_at?: string | null
          checked_out_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_activity_at?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
          work_date: string
          worked_minutes?: number | null
        }
        Update: {
          check_in_source?: string | null
          check_out_source?: string | null
          checked_in_at?: string | null
          checked_out_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_activity_at?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
          work_date?: string
          worked_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_days_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_days_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          expected_check_in: string | null
          expected_minutes: number | null
          grace_minutes: number
          id: string
          is_default: boolean
          name: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workdays: number[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expected_check_in?: string | null
          expected_minutes?: number | null
          grace_minutes?: number
          id?: string
          is_default?: boolean
          name: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          workdays?: number[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expected_check_in?: string | null
          expected_minutes?: number | null
          grace_minutes?: number
          id?: string
          is_default?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          workdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          payload: Json
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          payload?: Json
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          payload?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_series: {
        Row: {
          created_at: string
          created_by: string | null
          first_ends_at: string
          first_starts_at: string
          freq: string
          id: string
          interval_weeks: number
          repeat_count: number
          resource_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          first_ends_at: string
          first_starts_at: string
          freq: string
          id?: string
          interval_weeks?: number
          repeat_count: number
          resource_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          first_ends_at?: string
          first_starts_at?: string
          freq?: string
          id?: string
          interval_weeks?: number
          repeat_count?: number
          resource_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booked_by: string | null
          campaign_id: string | null
          created_at: string
          created_by: string | null
          deliverable_id: string | null
          ends_at: string
          id: string
          is_exclusive: boolean
          job_id: string | null
          load_pct: number | null
          notes: string | null
          resource_id: string
          series_id: string | null
          soft_hold_expires_at: string | null
          starts_at: string
          state: Database["public"]["Enums"]["booking_state"]
          sub_task_id: string | null
          tenant_id: string
          timespan: unknown
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          booked_by?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id?: string | null
          ends_at: string
          id?: string
          is_exclusive?: boolean
          job_id?: string | null
          load_pct?: number | null
          notes?: string | null
          resource_id: string
          series_id?: string | null
          soft_hold_expires_at?: string | null
          starts_at: string
          state?: Database["public"]["Enums"]["booking_state"]
          sub_task_id?: string | null
          tenant_id: string
          timespan?: unknown
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          booked_by?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id?: string | null
          ends_at?: string
          id?: string
          is_exclusive?: boolean
          job_id?: string | null
          load_pct?: number | null
          notes?: string | null
          resource_id?: string
          series_id?: string | null
          soft_hold_expires_at?: string | null
          starts_at?: string
          state?: Database["public"]["Enums"]["booking_state"]
          sub_task_id?: string | null
          tenant_id?: string
          timespan?: unknown
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_booked_by_fkey"
            columns: ["booked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "bookings_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "bookings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "booking_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_sub_task_id_fkey"
            columns: ["sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          short_name: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          short_name?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          short_name?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brands_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_deliverable_types: {
        Row: {
          brief_type: string
          created_at: string
          created_by: string | null
          deliverable_type_id: string
          id: string
          tenant_id: string
          updated_by: string | null
        }
        Insert: {
          brief_type: string
          created_at?: string
          created_by?: string | null
          deliverable_type_id: string
          id?: string
          tenant_id: string
          updated_by?: string | null
        }
        Update: {
          brief_type?: string
          created_at?: string
          created_by?: string | null
          deliverable_type_id?: string
          id?: string
          tenant_id?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brief_deliverable_types_deliverable_type_id_fkey"
            columns: ["deliverable_type_id"]
            isOneToOne: false
            referencedRelation: "deliverable_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_deliverable_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_templates: {
        Row: {
          brief_type: string
          created_at: string
          created_by: string | null
          description_ar: string | null
          description_en: string | null
          fields: Json
          id: string
          is_active: boolean
          name_ar: string | null
          name_en: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          brief_type: string
          created_at?: string
          created_by?: string | null
          description_ar?: string | null
          description_en?: string | null
          fields?: Json
          id?: string
          is_active?: boolean
          name_ar?: string | null
          name_en?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          brief_type?: string
          created_at?: string
          created_by?: string | null
          description_ar?: string | null
          description_en?: string | null
          fields?: Json
          id?: string
          is_active?: boolean
          name_ar?: string | null
          name_en?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brief_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_brief_receipts: {
        Row: {
          asset_id: string | null
          campaign_id: string
          captured_at: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          model: string | null
          received_at: string | null
          received_tz: string | null
          source: string
          subject: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          asset_id?: string | null
          campaign_id: string
          captured_at?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string | null
          received_at?: string | null
          received_tz?: string | null
          source?: string
          subject?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          asset_id?: string | null
          campaign_id?: string
          captured_at?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string | null
          received_at?: string | null
          received_tz?: string | null
          source?: string
          subject?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_brief_receipts_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_brief_receipts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_brief_receipts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_brief_receipts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_brief_receipts_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_brief_receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_briefs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brief_type: string
          campaign_id: string
          created_at: string
          created_by: string | null
          department_id: string
          id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          values: Json
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brief_type: string
          campaign_id: string
          created_at?: string
          created_by?: string | null
          department_id: string
          id?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          values?: Json
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brief_type?: string
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          department_id?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "campaign_briefs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_briefs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_briefs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_briefs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_briefs_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_briefs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_concepts: {
        Row: {
          campaign_brief_id: string
          created_at: string
          created_by: string | null
          id: string
          model: string
          proposals: Json
          regenerated_at: string | null
          regenerated_by: string | null
          regenerations: number
          requested_by: string | null
          slots: Json
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          campaign_brief_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          model: string
          proposals?: Json
          regenerated_at?: string | null
          regenerated_by?: string | null
          regenerations?: number
          requested_by?: string | null
          slots?: Json
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          campaign_brief_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string
          proposals?: Json
          regenerated_at?: string | null
          regenerated_by?: string | null
          regenerations?: number
          requested_by?: string | null
          slots?: Json
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_concepts_campaign_brief_id_fkey"
            columns: ["campaign_brief_id"]
            isOneToOne: true
            referencedRelation: "campaign_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_concepts_regenerated_by_fkey"
            columns: ["regenerated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_concepts_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_concepts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_phases: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string | null
          ends_on: string
          ends_on_event: string | null
          id: string
          name: string
          number: number
          starts_on: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by?: string | null
          ends_on: string
          ends_on_event?: string | null
          id?: string
          name: string
          number: number
          starts_on: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          ends_on?: string
          ends_on_event?: string | null
          id?: string
          name?: string
          number?: number
          starts_on?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_phases_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_phases_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_phases_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_phases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          account_manager_id: string | null
          approved_at: string | null
          approved_by: string | null
          audience: string | null
          brand_id: string | null
          brief: Json | null
          client_id: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          go_live_at: string | null
          has_phases: boolean
          id: string
          insight: string | null
          kind: string
          languages: string[]
          merged_into_id: string | null
          name: string
          odoo_analytic_code: string | null
          proposition: string | null
          status: string
          submitted_at: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_manager_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          audience?: string | null
          brand_id?: string | null
          brief?: Json | null
          client_id: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          go_live_at?: string | null
          has_phases?: boolean
          id?: string
          insight?: string | null
          kind?: string
          languages?: string[]
          merged_into_id?: string | null
          name: string
          odoo_analytic_code?: string | null
          proposition?: string | null
          status?: string
          submitted_at?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_manager_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          audience?: string | null
          brand_id?: string | null
          brief?: Json | null
          client_id?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          go_live_at?: string | null
          has_phases?: boolean
          id?: string
          insight?: string | null
          kind?: string
          languages?: string[]
          merged_into_id?: string | null
          name?: string
          odoo_analytic_code?: string | null
          proposition?: string | null
          status?: string
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_account_manager_id_fkey"
            columns: ["account_manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          can_request: boolean
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          is_copied: boolean
          name: string
          reach: string[]
          role_title: string | null
          signs_off: boolean
          sort_order: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          can_request?: boolean
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_copied?: boolean
          name: string
          reach?: string[]
          role_title?: string | null
          signs_off?: boolean
          sort_order?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          can_request?: boolean
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_copied?: boolean
          name?: string
          reach?: string[]
          role_title?: string | null
          signs_off?: boolean
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          account_manager_id: string | null
          activated_at: string | null
          activated_by: string | null
          activation_requested_at: string | null
          activation_requested_by: string | null
          country_code: string | null
          created_at: string
          created_by: string | null
          id: string
          internal_department_id: string | null
          internal_kind: string | null
          internal_team_id: string | null
          is_internal: boolean
          name: string
          odoo_analytic_code: string | null
          portal_enabled: boolean
          profile: Json | null
          related_client_id: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_manager_id?: string | null
          activated_at?: string | null
          activated_by?: string | null
          activation_requested_at?: string | null
          activation_requested_by?: string | null
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_department_id?: string | null
          internal_kind?: string | null
          internal_team_id?: string | null
          is_internal?: boolean
          name: string
          odoo_analytic_code?: string | null
          portal_enabled?: boolean
          profile?: Json | null
          related_client_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_manager_id?: string | null
          activated_at?: string | null
          activated_by?: string | null
          activation_requested_at?: string | null
          activation_requested_by?: string | null
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_department_id?: string | null
          internal_kind?: string | null
          internal_team_id?: string | null
          is_internal?: boolean
          name?: string
          odoo_analytic_code?: string | null
          portal_enabled?: boolean
          profile?: Json | null
          related_client_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_account_manager_id_fkey"
            columns: ["account_manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_activation_requested_by_fkey"
            columns: ["activation_requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_country_fk"
            columns: ["tenant_id", "country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["tenant_id", "code"]
          },
          {
            foreignKeyName: "clients_internal_department_id_fkey"
            columns: ["internal_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_internal_team_id_fkey"
            columns: ["internal_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_related_client_id_fkey"
            columns: ["related_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          added_by: string | null
          conversation_id: string
          created_by: string | null
          joined_at: string
          last_read_seq: number
          muted: boolean
          role: string
          tenant_id: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          added_by?: string | null
          conversation_id: string
          created_by?: string | null
          joined_at?: string
          last_read_seq?: number
          muted?: boolean
          role?: string
          tenant_id: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          added_by?: string | null
          conversation_id?: string
          created_by?: string | null
          joined_at?: string
          last_read_seq?: number
          muted?: boolean
          role?: string
          tenant_id?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          context_id: string | null
          context_type: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          last_message_at: string | null
          tenant_id: string
          title: string | null
          updated_by: string | null
        }
        Insert: {
          context_id?: string | null
          context_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          tenant_id: string
          title?: string | null
          updated_by?: string | null
        }
        Update: {
          context_id?: string | null
          context_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          tenant_id?: string
          title?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          name_ar: string
          name_en: string
          sort_order: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          working_days: number[]
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          name_ar: string
          name_en: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          working_days: number[]
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name_ar?: string
          name_en?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          working_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "countries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "countries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "countries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverable_attribute_values: {
        Row: {
          attribute: Database["public"]["Enums"]["deliverable_attribute"]
          behaviour: string | null
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          label_ar: string | null
          label_en: string
          sort_order: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          attribute: Database["public"]["Enums"]["deliverable_attribute"]
          behaviour?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label_ar?: string | null
          label_en: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          attribute?: Database["public"]["Enums"]["deliverable_attribute"]
          behaviour?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label_ar?: string | null
          label_en?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverable_attribute_values_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverable_categories: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name_ar: string | null
          name_en: string
          sort_order: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string | null
          name_en: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string | null
          name_en?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverable_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverable_change_asks: {
        Row: {
          answer_note: string | null
          answered_at: string | null
          answered_by: string | null
          applied_due_day: string | null
          applied_hours: number | null
          asked_by: string
          created_at: string
          created_by: string | null
          deliverable_id: string
          escalated_at: string | null
          from_sub_task_id: string | null
          id: string
          kinds: string[]
          reason: string
          requested_due_day: string | null
          requested_hours: number | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          answer_note?: string | null
          answered_at?: string | null
          answered_by?: string | null
          applied_due_day?: string | null
          applied_hours?: number | null
          asked_by: string
          created_at?: string
          created_by?: string | null
          deliverable_id: string
          escalated_at?: string | null
          from_sub_task_id?: string | null
          id?: string
          kinds: string[]
          reason: string
          requested_due_day?: string | null
          requested_hours?: number | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          answer_note?: string | null
          answered_at?: string | null
          answered_by?: string | null
          applied_due_day?: string | null
          applied_hours?: number | null
          asked_by?: string
          created_at?: string
          created_by?: string | null
          deliverable_id?: string
          escalated_at?: string | null
          from_sub_task_id?: string | null
          id?: string
          kinds?: string[]
          reason?: string
          requested_due_day?: string | null
          requested_hours?: number | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverable_change_asks_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_change_asks_asked_by_fkey"
            columns: ["asked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_change_asks_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_change_asks_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "deliverable_change_asks_from_sub_task_id_fkey"
            columns: ["from_sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_change_asks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverable_change_requests: {
        Row: {
          answered_at: string | null
          answered_by: string | null
          asked_by: string
          changes: Json
          closed_at: string | null
          cost: Json
          counter_date: string | null
          counter_text: string | null
          created_at: string
          created_by: string | null
          decline_reason: string | null
          deliverable_id: string
          evidence_asset_id: string | null
          evidence_attached: boolean | null
          id: string
          owner_user_id: string | null
          requested_by: string
          resolved_at: string | null
          resolved_by: string | null
          round_spent: boolean
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          answered_at?: string | null
          answered_by?: string | null
          asked_by: string
          changes: Json
          closed_at?: string | null
          cost?: Json
          counter_date?: string | null
          counter_text?: string | null
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          deliverable_id: string
          evidence_asset_id?: string | null
          evidence_attached?: boolean | null
          id?: string
          owner_user_id?: string | null
          requested_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          round_spent?: boolean
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          answered_at?: string | null
          answered_by?: string | null
          asked_by?: string
          changes?: Json
          closed_at?: string | null
          cost?: Json
          counter_date?: string | null
          counter_text?: string | null
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          deliverable_id?: string
          evidence_asset_id?: string | null
          evidence_attached?: boolean | null
          id?: string
          owner_user_id?: string | null
          requested_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          round_spent?: boolean
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverable_change_requests_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_change_requests_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "deliverable_change_requests_evidence_asset_id_fkey"
            columns: ["evidence_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_change_requests_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_change_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverable_pending_inputs: {
        Row: {
          awaited_from: string | null
          created_at: string
          created_by: string | null
          deliverable_id: string
          description: string
          id: string
          kind: string | null
          requested_at: string
          satisfied_at: string | null
          sub_task_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          awaited_from?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id: string
          description: string
          id?: string
          kind?: string | null
          requested_at?: string
          satisfied_at?: string | null
          sub_task_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          awaited_from?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id?: string
          description?: string
          id?: string
          kind?: string | null
          requested_at?: string
          satisfied_at?: string | null
          sub_task_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverable_pending_inputs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_pending_inputs_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_pending_inputs_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "deliverable_pending_inputs_sub_task_id_fkey"
            columns: ["sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_pending_inputs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverable_types: {
        Row: {
          category_code: string
          code: string
          created_at: string
          created_by: string | null
          default_load_pct: number | null
          default_workflow_template_id: string | null
          id: string
          is_active: boolean
          lead_time_hours: number | null
          name_ar: string | null
          name_en: string
          revision_limit: number | null
          sla_profile_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category_code: string
          code: string
          created_at?: string
          created_by?: string | null
          default_load_pct?: number | null
          default_workflow_template_id?: string | null
          id?: string
          is_active?: boolean
          lead_time_hours?: number | null
          name_ar?: string | null
          name_en: string
          revision_limit?: number | null
          sla_profile_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category_code?: string
          code?: string
          created_at?: string
          created_by?: string | null
          default_load_pct?: number | null
          default_workflow_template_id?: string | null
          id?: string
          is_active?: boolean
          lead_time_hours?: number | null
          name_ar?: string | null
          name_en?: string
          revision_limit?: number | null
          sla_profile_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverable_types_sla_profile_id_fkey"
            columns: ["sla_profile_id"]
            isOneToOne: false
            referencedRelation: "sla_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverable_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_deliverable_types_category"
            columns: ["tenant_id", "category_code"]
            isOneToOne: false
            referencedRelation: "deliverable_categories"
            referencedColumns: ["tenant_id", "code"]
          },
          {
            foreignKeyName: "fk_deliverable_types_workflow_template"
            columns: ["default_workflow_template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverables: {
        Row: {
          assignment_escalated_at: string | null
          channel: string | null
          client_approval: string | null
          code: string | null
          complexity: string | null
          content_idea: string | null
          created_at: string
          created_by: string | null
          deliverable_type_id: string | null
          department_id: string | null
          due_at: string | null
          finished_at: string | null
          format: string | null
          id: string
          is_given_to_client: boolean
          job_id: string | null
          languages: string[]
          name: string
          notes: string | null
          orientation: string | null
          owner_user_id: string | null
          phase_id: string | null
          priority: string | null
          production_type: string | null
          quantity: number
          reviewer_id: string | null
          revision_limit: number | null
          revision_round: number
          state: Database["public"]["Enums"]["deliverable_state"]
          stream_id: string | null
          task_list_reopened_at: string | null
          tasks_approved_at: string | null
          tasks_approved_by: string | null
          tenant_id: string
          unassigned_at_signoff: number | null
          updated_at: string
          updated_by: string | null
          workstream_id: string | null
        }
        Insert: {
          assignment_escalated_at?: string | null
          channel?: string | null
          client_approval?: string | null
          code?: string | null
          complexity?: string | null
          content_idea?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_type_id?: string | null
          department_id?: string | null
          due_at?: string | null
          finished_at?: string | null
          format?: string | null
          id?: string
          is_given_to_client?: boolean
          job_id?: string | null
          languages?: string[]
          name: string
          notes?: string | null
          orientation?: string | null
          owner_user_id?: string | null
          phase_id?: string | null
          priority?: string | null
          production_type?: string | null
          quantity?: number
          reviewer_id?: string | null
          revision_limit?: number | null
          revision_round?: number
          state?: Database["public"]["Enums"]["deliverable_state"]
          stream_id?: string | null
          task_list_reopened_at?: string | null
          tasks_approved_at?: string | null
          tasks_approved_by?: string | null
          tenant_id: string
          unassigned_at_signoff?: number | null
          updated_at?: string
          updated_by?: string | null
          workstream_id?: string | null
        }
        Update: {
          assignment_escalated_at?: string | null
          channel?: string | null
          client_approval?: string | null
          code?: string | null
          complexity?: string | null
          content_idea?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_type_id?: string | null
          department_id?: string | null
          due_at?: string | null
          finished_at?: string | null
          format?: string | null
          id?: string
          is_given_to_client?: boolean
          job_id?: string | null
          languages?: string[]
          name?: string
          notes?: string | null
          orientation?: string | null
          owner_user_id?: string | null
          phase_id?: string | null
          priority?: string | null
          production_type?: string | null
          quantity?: number
          reviewer_id?: string | null
          revision_limit?: number | null
          revision_round?: number
          state?: Database["public"]["Enums"]["deliverable_state"]
          stream_id?: string | null
          task_list_reopened_at?: string | null
          tasks_approved_at?: string | null
          tasks_approved_by?: string | null
          tenant_id?: string
          unassigned_at_signoff?: number | null
          updated_at?: string
          updated_by?: string | null
          workstream_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverables_deliverable_type_id_fkey"
            columns: ["deliverable_type_id"]
            isOneToOne: false
            referencedRelation: "deliverable_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "campaign_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "streams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_tasks_approved_by_fkey"
            columns: ["tasks_approved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "workstreams"
            referencedColumns: ["id"]
          },
        ]
      }
      department_brief_templates: {
        Row: {
          brief_template_id: string
          created_at: string
          created_by: string | null
          department_id: string
          is_default: boolean
          tenant_id: string
          updated_by: string | null
        }
        Insert: {
          brief_template_id: string
          created_at?: string
          created_by?: string | null
          department_id: string
          is_default?: boolean
          tenant_id: string
          updated_by?: string | null
        }
        Update: {
          brief_template_id?: string
          created_at?: string
          created_by?: string | null
          department_id?: string
          is_default?: boolean
          tenant_id?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_brief_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_dbt_department"
            columns: ["tenant_id", "department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_dbt_template"
            columns: ["tenant_id", "brief_template_id"]
            isOneToOne: false
            referencedRelation: "brief_templates"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_production: boolean
          name: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_production?: boolean
          name: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_production?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_log: {
        Row: {
          created_at: string
          created_by: string | null
          fallback: boolean
          fallback_reason: string | null
          id: string
          kind: string
          occurrence: string
          recipients: number
          sent_at: string
          subject_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fallback?: boolean
          fallback_reason?: string | null
          id?: string
          kind: string
          occurrence?: string
          recipients?: number
          sent_at?: string
          subject_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fallback?: boolean
          fallback_reason?: string | null
          id?: string
          kind?: string
          occurrence?: string
          recipients?: number
          sent_at?: string
          subject_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalation_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_unreached: {
        Row: {
          created_at: string
          created_by: string | null
          first_tried_at: string
          id: string
          kind: string
          last_tried_at: string
          occurrence: string
          reason: string | null
          subject_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          first_tried_at?: string
          id?: string
          kind: string
          last_tried_at?: string
          occurrence?: string
          reason?: string | null
          subject_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          first_tried_at?: string
          id?: string
          kind?: string
          last_tried_at?: string
          occurrence?: string
          reason?: string | null
          subject_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalation_unreached_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          campaign_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          odoo_analytic_code: string | null
          owner_user_id: string | null
          sla_profile_id: string | null
          source_deliverable_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          campaign_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          odoo_analytic_code?: string | null
          owner_user_id?: string | null
          sla_profile_id?: string | null
          source_deliverable_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          campaign_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          odoo_analytic_code?: string | null
          owner_user_id?: string | null
          sla_profile_id?: string | null
          source_deliverable_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_sla_profile_id_fkey"
            columns: ["sla_profile_id"]
            isOneToOne: false
            referencedRelation: "sla_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_source_deliverable_id_fkey"
            columns: ["source_deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_source_deliverable_id_fkey"
            columns: ["source_deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      joint_project_grants: {
        Row: {
          created_at: string
          granted_role: string
          id: string
          joint_project_id: string
          user_id: string
          user_tenant_id: string
        }
        Insert: {
          created_at?: string
          granted_role: string
          id?: string
          joint_project_id: string
          user_id: string
          user_tenant_id: string
        }
        Update: {
          created_at?: string
          granted_role?: string
          id?: string
          joint_project_id?: string
          user_id?: string
          user_tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "joint_project_grants_joint_project_id_fkey"
            columns: ["joint_project_id"]
            isOneToOne: false
            referencedRelation: "joint_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "joint_project_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "joint_project_grants_user_tenant_id_fkey"
            columns: ["user_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      joint_projects: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string | null
          host_tenant_id: string
          id: string
          invited_tenant_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by?: string | null
          host_tenant_id: string
          id?: string
          invited_tenant_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          host_tenant_id?: string
          id?: string
          invited_tenant_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "joint_projects_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "joint_projects_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "joint_projects_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "joint_projects_host_tenant_id_fkey"
            columns: ["host_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "joint_projects_invited_tenant_id_fkey"
            columns: ["invited_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_definitions: {
        Row: {
          aggregation: string
          created_at: string
          created_by: string | null
          deliverable_type_id: string | null
          formula: Json
          higher_is_better: boolean
          id: string
          metric_key: string | null
          name: string
          source: string
          tenant_id: string
          unit: string | null
          updated_by: string | null
        }
        Insert: {
          aggregation?: string
          created_at?: string
          created_by?: string | null
          deliverable_type_id?: string | null
          formula?: Json
          higher_is_better?: boolean
          id?: string
          metric_key?: string | null
          name: string
          source?: string
          tenant_id: string
          unit?: string | null
          updated_by?: string | null
        }
        Update: {
          aggregation?: string
          created_at?: string
          created_by?: string | null
          deliverable_type_id?: string | null
          formula?: Json
          higher_is_better?: boolean
          id?: string
          metric_key?: string | null
          name?: string
          source?: string
          tenant_id?: string
          unit?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_definitions_deliverable_type_id_fkey"
            columns: ["deliverable_type_id"]
            isOneToOne: false
            referencedRelation: "deliverable_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_targets: {
        Row: {
          actual: number | null
          actual_source: string
          created_by: string | null
          id: string
          kpi_definition_id: string
          period_end: string
          period_start: string
          target: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          actual?: number | null
          actual_source?: string
          created_by?: string | null
          id?: string
          kpi_definition_id: string
          period_end: string
          period_start: string
          target?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          actual?: number | null
          actual_source?: string
          created_by?: string | null
          id?: string
          kpi_definition_id?: string
          period_end?: string
          period_start?: string
          target?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_targets_kpi_definition_id_fkey"
            columns: ["kpi_definition_id"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_targets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_targets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_targets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      library_archive_requests: {
        Row: {
          asset_id: string
          attempts: number
          created_at: string
          created_by: string | null
          id: string
          last_error: string | null
          online_until: string | null
          requested_by: string
          restored_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          asset_id: string
          attempts?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          online_until?: string | null
          requested_by: string
          restored_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          asset_id?: string
          attempts?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          online_until?: string | null
          requested_by?: string
          restored_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_archive_requests_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_archive_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_archive_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      media_records: {
        Row: {
          archive_due_at: string | null
          archive_ref: string | null
          archived_at: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          deliverable_id: string
          delivered_at: string | null
          delivered_by: string | null
          delivery_round: number | null
          external_review_url: string | null
          file_name: string | null
          id: string
          object_key: string | null
          provider: string
          retention_state: string
          round: number
          size_bytes: number | null
          storage_tier: string
          sub_task_id: string | null
          superseded_at: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          uploaded_by: string | null
          version: number
        }
        Insert: {
          archive_due_at?: string | null
          archive_ref?: string | null
          archived_at?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id: string
          delivered_at?: string | null
          delivered_by?: string | null
          delivery_round?: number | null
          external_review_url?: string | null
          file_name?: string | null
          id?: string
          object_key?: string | null
          provider?: string
          retention_state?: string
          round: number
          size_bytes?: number | null
          storage_tier?: string
          sub_task_id?: string | null
          superseded_at?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          uploaded_by?: string | null
          version: number
        }
        Update: {
          archive_due_at?: string | null
          archive_ref?: string | null
          archived_at?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id?: string
          delivered_at?: string | null
          delivered_by?: string | null
          delivery_round?: number | null
          external_review_url?: string | null
          file_name?: string | null
          id?: string
          object_key?: string | null
          provider?: string
          retention_state?: string
          round?: number
          size_bytes?: number | null
          storage_tier?: string
          sub_task_id?: string | null
          superseded_at?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_records_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_records_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "media_records_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_records_sub_task_id_fkey"
            columns: ["sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_records_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          sender_id: string
          seq: number
          tenant_id: string
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id: string
          sender_id: string
          seq: number
          tenant_id: string
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          sender_id?: string
          seq?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          context_label: string | null
          created_at: string
          detail: Json
          entity_id: string | null
          entity_type: string | null
          id: string
          label: string | null
          read_at: string | null
          seq: number
          tenant_id: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          context_label?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          label?: string | null
          read_at?: string | null
          seq?: never
          tenant_id: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          context_label?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          label?: string | null
          read_at?: string | null
          seq?: never
          tenant_id?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      office_closures: {
        Row: {
          created_at: string
          created_by: string | null
          ends_on: string
          id: string
          kind: string
          name: string
          office_id: string
          starts_on: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_on: string
          id?: string
          kind: string
          name: string
          office_id: string
          starts_on: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_on?: string
          id?: string
          kind?: string
          name?: string
          office_id?: string
          starts_on?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "office_closures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_closures_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_closures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      offices: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          tenant_id: string
          timezone: string
          updated_at: string
          updated_by: string | null
          working_days: number[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          tenant_id: string
          timezone: string
          updated_at?: string
          updated_by?: string | null
          working_days?: number[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          tenant_id?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          working_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "offices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_catalog: {
        Row: {
          action: string
          created_at: string
          description: string
          resource: string
        }
        Insert: {
          action: string
          created_at?: string
          description: string
          resource: string
        }
        Update: {
          action?: string
          created_at?: string
          description?: string
          resource?: string
        }
        Relationships: []
      }
      piece_messages: {
        Row: {
          answered_at: string | null
          answered_by: string | null
          author_id: string
          body: string | null
          created_at: string
          created_by: string | null
          deliverable_id: string | null
          id: string
          kind: string
          parent_id: string | null
          recipients: string[]
          status: string | null
          sub_task_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          answered_at?: string | null
          answered_by?: string | null
          author_id: string
          body?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id?: string | null
          id?: string
          kind: string
          parent_id?: string | null
          recipients?: string[]
          status?: string | null
          sub_task_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          answered_at?: string | null
          answered_by?: string | null
          author_id?: string
          body?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id?: string | null
          id?: string
          kind?: string
          parent_id?: string | null
          recipients?: string[]
          status?: string | null
          sub_task_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "piece_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piece_messages_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piece_messages_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "piece_messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "piece_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piece_messages_sub_task_id_fkey"
            columns: ["sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "piece_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_unavailability: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          ends_at: string
          hours: number | null
          id: string
          kind: string
          reason: string | null
          resource_id: string
          starts_at: string
          tenant_id: string
          timespan: unknown
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          ends_at: string
          hours?: number | null
          id?: string
          kind: string
          reason?: string | null
          resource_id: string
          starts_at: string
          tenant_id: string
          timespan?: unknown
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string
          hours?: number | null
          id?: string
          kind?: string
          reason?: string | null
          resource_id?: string
          starts_at?: string
          tenant_id?: string
          timespan?: unknown
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resource_unavailability_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_unavailability_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          capacity_model: Database["public"]["Enums"]["capacity_model"]
          charge_rate: number | null
          cost_rate: number | null
          created_at: string
          created_by: string | null
          currency: string
          department_id: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["resource_kind"]
          load_ceiling_pct: number | null
          name: string
          nickname: string | null
          office_id: string | null
          pool_size: number | null
          requires_approval: boolean
          team_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_id: string | null
          warn_at_pct: number | null
        }
        Insert: {
          capacity_model: Database["public"]["Enums"]["capacity_model"]
          charge_rate?: number | null
          cost_rate?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          department_id?: string | null
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["resource_kind"]
          load_ceiling_pct?: number | null
          name: string
          nickname?: string | null
          office_id?: string | null
          pool_size?: number | null
          requires_approval?: boolean
          team_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          warn_at_pct?: number | null
        }
        Update: {
          capacity_model?: Database["public"]["Enums"]["capacity_model"]
          charge_rate?: number | null
          cost_rate?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          department_id?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["resource_kind"]
          load_ceiling_pct?: number | null
          name?: string
          nickname?: string | null
          office_id?: string | null
          pool_size?: number | null
          requires_approval?: boolean
          team_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          warn_at_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      review_feedback: {
        Row: {
          author_user_id: string | null
          body: string
          created_at: string
          created_by: string | null
          done_at: string | null
          done_by: string | null
          id: string
          link_url: string | null
          media_record_id: string | null
          page: number | null
          parent_id: string | null
          pos_x: number | null
          pos_y: number | null
          resolved: boolean
          round: number
          source: string
          sub_task_id: string | null
          tenant_id: string
          timecode_ms: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          author_user_id?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          id?: string
          link_url?: string | null
          media_record_id?: string | null
          page?: number | null
          parent_id?: string | null
          pos_x?: number | null
          pos_y?: number | null
          resolved?: boolean
          round?: number
          source: string
          sub_task_id?: string | null
          tenant_id: string
          timecode_ms?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          author_user_id?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          id?: string
          link_url?: string | null
          media_record_id?: string | null
          page?: number | null
          parent_id?: string | null
          pos_x?: number | null
          pos_y?: number | null
          resolved?: boolean
          round?: number
          source?: string
          sub_task_id?: string | null
          tenant_id?: string
          timecode_ms?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_feedback_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_feedback_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_feedback_media_record_id_fkey"
            columns: ["media_record_id"]
            isOneToOne: false
            referencedRelation: "media_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_feedback_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "review_feedback"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_feedback_sub_task_id_fkey"
            columns: ["sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_feedback_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_grants: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          resource: string
          role_id: string
          tenant_id: string
          updated_by: string | null
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          resource: string
          role_id: string
          tenant_id: string
          updated_by?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          resource?: string
          role_id?: string
          tenant_id?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_grants_resource_action_fkey"
            columns: ["resource", "action"]
            isOneToOne: false
            referencedRelation: "permission_catalog"
            referencedColumns: ["resource", "action"]
          },
          {
            foreignKeyName: "role_grants_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          created_by: string | null
          default_route: string
          description: string | null
          id: string
          is_system: boolean
          key: string
          name: string
          scope: string
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_route?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          name: string
          scope?: string
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_route?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          scope?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scope_acknowledgements: {
        Row: {
          acknowledged_at: string
          acknowledged_by: string
          acknowledged_via: string
          asset_id: string | null
          campaign_id: string
          created_at: string
          created_by: string | null
          has_days: number
          id: string
          needs_days: number
          note: string | null
          recorded_at: string
          recorded_by: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          acknowledged_at: string
          acknowledged_by: string
          acknowledged_via: string
          asset_id?: string | null
          campaign_id: string
          created_at?: string
          created_by?: string | null
          has_days: number
          id?: string
          needs_days: number
          note?: string | null
          recorded_at?: string
          recorded_by: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          acknowledged_at?: string
          acknowledged_by?: string
          acknowledged_via?: string
          asset_id?: string | null
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          has_days?: number
          id?: string
          needs_days?: number
          note?: string | null
          recorded_at?: string
          recorded_by?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scope_acknowledgements_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope_acknowledgements_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope_acknowledgements_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope_acknowledgements_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "scope_acknowledgements_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope_acknowledgements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_events: {
        Row: {
          actor_user_id: string | null
          attributed_to: Database["public"]["Enums"]["attribution_party"] | null
          booking_id: string | null
          created_at: string
          deliverable_id: string | null
          event_type: string
          id: string
          job_id: string | null
          payload: Json
          sub_task_id: string | null
          tenant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          attributed_to?:
            | Database["public"]["Enums"]["attribution_party"]
            | null
          booking_id?: string | null
          created_at?: string
          deliverable_id?: string | null
          event_type: string
          id?: string
          job_id?: string | null
          payload?: Json
          sub_task_id?: string | null
          tenant_id: string
        }
        Update: {
          actor_user_id?: string | null
          attributed_to?:
            | Database["public"]["Enums"]["attribution_party"]
            | null
          booking_id?: string | null
          created_at?: string
          deliverable_id?: string | null
          event_type?: string
          id?: string
          job_id?: string | null
          payload?: Json
          sub_task_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_sla_events_sub_task_tenant"
            columns: ["tenant_id", "sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "sla_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_events_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_events_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "sla_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_profiles: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          deadline_rule: Json
          id: string
          is_default: boolean
          name: string
          tenant_id: string
          turnaround_hours: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          deadline_rule?: Json
          id?: string
          is_default?: boolean
          name: string
          tenant_id: string
          turnaround_hours?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          deadline_rule?: Json
          id?: string
          is_default?: boolean
          name?: string
          tenant_id?: string
          turnaround_hours?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sla_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      streams: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          owner_user_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          owner_user_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          owner_user_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "streams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "streams_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_task_assignment_requests: {
        Row: {
          answer_note: string | null
          answered_at: string | null
          answered_by: string | null
          assignee_id: string | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          due_at: string | null
          escalated_at: string | null
          hours: number | null
          id: string
          needed_by: string | null
          note: string | null
          offered_ends_at: string | null
          offered_starts_at: string | null
          reason: string | null
          requested_at: string
          requested_by: string
          resource_id: string | null
          review_mode: string | null
          reviewers: Json | null
          starts_at: string | null
          status: string
          sub_task_id: string
          team_id: string | null
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          answer_note?: string | null
          answered_at?: string | null
          answered_by?: string | null
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          due_at?: string | null
          escalated_at?: string | null
          hours?: number | null
          id?: string
          needed_by?: string | null
          note?: string | null
          offered_ends_at?: string | null
          offered_starts_at?: string | null
          reason?: string | null
          requested_at?: string
          requested_by: string
          resource_id?: string | null
          review_mode?: string | null
          reviewers?: Json | null
          starts_at?: string | null
          status?: string
          sub_task_id: string
          team_id?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          answer_note?: string | null
          answered_at?: string | null
          answered_by?: string | null
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          due_at?: string | null
          escalated_at?: string | null
          hours?: number | null
          id?: string
          needed_by?: string | null
          note?: string | null
          offered_ends_at?: string | null
          offered_starts_at?: string | null
          reason?: string | null
          requested_at?: string
          requested_by?: string
          resource_id?: string | null
          review_mode?: string | null
          reviewers?: Json | null
          starts_at?: string | null
          status?: string
          sub_task_id?: string
          team_id?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sub_task_assignment_requests_resource"
            columns: ["tenant_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_sub_task_assignment_requests_sub_task"
            columns: ["tenant_id", "sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "sub_task_assignment_requests_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_assignment_requests_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_assignment_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_assignment_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_assignment_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_assignment_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_task_dependencies: {
        Row: {
          created_at: string
          created_by: string | null
          depends_on_sub_task_id: string
          id: string
          sub_task_id: string
          tenant_id: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          depends_on_sub_task_id: string
          id?: string
          sub_task_id: string
          tenant_id: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          depends_on_sub_task_id?: string
          id?: string
          sub_task_id?: string
          tenant_id?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sub_task_dependencies_depends_on_sub_task_id_fkey"
            columns: ["depends_on_sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_dependencies_sub_task_id_fkey"
            columns: ["sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_dependencies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_task_reopenings: {
        Row: {
          assignee_id: string | null
          campaign_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          deliverable_id: string
          due_at: string
          hours: number | null
          id: string
          kind: string
          reason: string
          reopened_at: string
          reopened_by: string | null
          sub_task_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assignee_id?: string | null
          campaign_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id: string
          due_at: string
          hours?: number | null
          id?: string
          kind: string
          reason: string
          reopened_at?: string
          reopened_by?: string | null
          sub_task_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assignee_id?: string | null
          campaign_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id?: string
          due_at?: string
          hours?: number | null
          id?: string
          kind?: string
          reason?: string
          reopened_at?: string
          reopened_by?: string | null
          sub_task_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sub_task_reopenings_sub_task"
            columns: ["tenant_id", "sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "sub_task_reopenings_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_reopenings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_reopenings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_reopenings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "sub_task_reopenings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_reopenings_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_reopenings_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "sub_task_reopenings_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_reopenings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_task_resources: {
        Row: {
          created_at: string
          created_by: string | null
          hours: number
          id: string
          notes: string | null
          resource_id: string
          starts_on: string | null
          sub_task_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hours: number
          id?: string
          notes?: string | null
          resource_id: string
          starts_on?: string | null
          sub_task_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hours?: number
          id?: string
          notes?: string | null
          resource_id?: string
          starts_on?: string | null
          sub_task_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sub_task_resources_resource"
            columns: ["tenant_id", "resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_sub_task_resources_sub_task"
            columns: ["tenant_id", "sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "sub_task_resources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_resources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_task_reviewers: {
        Row: {
          approved_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_mandatory: boolean
          responded_at: string | null
          response: string | null
          sub_task_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_mandatory?: boolean
          responded_at?: string | null
          response?: string | null
          sub_task_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_mandatory?: boolean
          responded_at?: string | null
          response?: string | null
          sub_task_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_sub_task_reviewers_created_by"
            columns: ["tenant_id", "created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_sub_task_reviewers_sub_task"
            columns: ["tenant_id", "sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "fk_sub_task_reviewers_user"
            columns: ["tenant_id", "user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "sub_task_reviewers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_task_time_asks: {
        Row: {
          answer_note: string | null
          answered_at: string | null
          answered_by: string | null
          asked_by: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          status: string
          sub_task_id: string
          tenant_id: string
          to_day: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          answer_note?: string | null
          answered_at?: string | null
          answered_by?: string | null
          asked_by: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          status?: string
          sub_task_id: string
          tenant_id: string
          to_day: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          answer_note?: string | null
          answered_at?: string | null
          answered_by?: string | null
          asked_by?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          status?: string
          sub_task_id?: string
          tenant_id?: string
          to_day?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sub_task_time_asks_sub_task"
            columns: ["tenant_id", "sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "sub_task_time_asks_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_time_asks_asked_by_fkey"
            columns: ["asked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_task_time_asks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_tasks: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assigned_at: string | null
          assigned_by: string | null
          assignee_id: string | null
          assignee_seen_at: string | null
          committed_due_at: string | null
          committed_hours: number | null
          committed_starts_at: string | null
          created_at: string
          created_by: string | null
          deliverable_id: string
          department_id: string | null
          description: string | null
          due_at: string | null
          id: string
          review_mode: string
          revision_number: number
          schedule_overridden: boolean
          sla_hours: number | null
          sla_profile_id: string | null
          sort_order: number | null
          starts_at: string | null
          status: string
          team_id: string | null
          tenant_id: string
          title: string
          unit_index: number | null
          updated_at: string
          updated_by: string | null
          workflow_step_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assignee_id?: string | null
          assignee_seen_at?: string | null
          committed_due_at?: string | null
          committed_hours?: number | null
          committed_starts_at?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id: string
          department_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          review_mode?: string
          revision_number?: number
          schedule_overridden?: boolean
          sla_hours?: number | null
          sla_profile_id?: string | null
          sort_order?: number | null
          starts_at?: string | null
          status?: string
          team_id?: string | null
          tenant_id: string
          title: string
          unit_index?: number | null
          updated_at?: string
          updated_by?: string | null
          workflow_step_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assignee_id?: string | null
          assignee_seen_at?: string | null
          committed_due_at?: string | null
          committed_hours?: number | null
          committed_starts_at?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_id?: string
          department_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          review_mode?: string
          revision_number?: number
          schedule_overridden?: boolean
          sla_hours?: number | null
          sla_profile_id?: string | null
          sort_order?: number | null
          starts_at?: string | null
          status?: string
          team_id?: string | null
          tenant_id?: string
          title?: string
          unit_index?: number | null
          updated_at?: string
          updated_by?: string | null
          workflow_step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sub_tasks_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "sub_tasks_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_sla_profile_id_fkey"
            columns: ["sla_profile_id"]
            isOneToOne: false
            referencedRelation: "sla_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_workflow_step_id_fkey"
            columns: ["workflow_step_id"]
            isOneToOne: false
            referencedRelation: "workflow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      task_time_entries: {
        Row: {
          blocked_minutes: number | null
          created_at: string
          created_by: string | null
          id: string
          minutes: number | null
          mode: string
          round: number
          started_ahead: boolean
          started_at: string | null
          sub_task_id: string
          submitted_at: string | null
          tenant_id: string
          untimed: boolean
          updated_by: string | null
          user_id: string
        }
        Insert: {
          blocked_minutes?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          minutes?: number | null
          mode: string
          round?: number
          started_ahead?: boolean
          started_at?: string | null
          sub_task_id: string
          submitted_at?: string | null
          tenant_id: string
          untimed?: boolean
          updated_by?: string | null
          user_id: string
        }
        Update: {
          blocked_minutes?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          minutes?: number | null
          mode?: string
          round?: number
          started_ahead?: boolean
          started_at?: string | null
          sub_task_id?: string
          submitted_at?: string | null
          tenant_id?: string
          untimed?: boolean
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_time_entries_sub_task_id_fkey"
            columns: ["sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_time_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string
          id: string
          name: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id: string
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_escalation_rules: {
        Row: {
          created_at: string
          created_by: string | null
          hours: number
          id: string
          kind: string
          relative: string[]
          role_ids: string[]
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hours: number
          id?: string
          kind: string
          relative?: string[]
          role_ids?: string[]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hours?: number
          id?: string
          kind?: string
          relative?: string[]
          role_ids?: string[]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_escalation_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_filler_words: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          word: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          word: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          word?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_filler_words_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_reminder_settings: {
        Row: {
          assignment_escalation_hours: number
          brief_approval_hours: number
          commence_days_before_delivery: number
          created_at: string
          created_by: string | null
          delivery_days_before_go_live: number
          over_capacity_pct: number
          review_buffer_working_days: number
          tenant_id: string
          untimed_threshold_minutes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assignment_escalation_hours?: number
          brief_approval_hours?: number
          commence_days_before_delivery?: number
          created_at?: string
          created_by?: string | null
          delivery_days_before_go_live?: number
          over_capacity_pct?: number
          review_buffer_working_days?: number
          tenant_id: string
          untimed_threshold_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assignment_escalation_hours?: number
          brief_approval_hours?: number
          commence_days_before_delivery?: number
          created_at?: string
          created_by?: string | null
          delivery_days_before_go_live?: number
          over_capacity_pct?: number
          review_buffer_working_days?: number
          tenant_id?: string
          untimed_threshold_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_reminder_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_storage_settings: {
        Row: {
          archive_after_days: number
          archive_location: string | null
          archive_provider: string | null
          archive_target: string
          created_at: string
          created_by: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          working_retention_days: number
        }
        Insert: {
          archive_after_days?: number
          archive_location?: string | null
          archive_provider?: string | null
          archive_target?: string
          created_at?: string
          created_by?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          working_retention_days?: number
        }
        Update: {
          archive_after_days?: number
          archive_location?: string | null
          archive_provider?: string | null
          archive_target?: string
          created_at?: string
          created_by?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          working_retention_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_storage_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          odoo_analytic_code: string | null
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          odoo_analytic_code?: string | null
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          odoo_analytic_code?: string | null
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_grants: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          effect: string
          granted_by: string
          reason: string | null
          resource: string
          tenant_id: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          effect: string
          granted_by: string
          reason?: string | null
          resource: string
          tenant_id: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          effect?: string
          granted_by?: string
          reason?: string | null
          resource?: string
          tenant_id?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_grants_resource_action_fkey"
            columns: ["resource", "action"]
            isOneToOne: false
            referencedRelation: "permission_catalog"
            referencedColumns: ["resource", "action"]
          },
          {
            foreignKeyName: "user_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string | null
          display_name: string
          email: string | null
          id: string
          is_active: boolean
          job_title: string | null
          leaving_since: string | null
          leaving_started_by: string | null
          locale: string
          office_id: string | null
          role_id: string
          team_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          display_name: string
          email?: string | null
          id: string
          is_active?: boolean
          job_title?: string | null
          leaving_since?: string | null
          leaving_started_by?: string | null
          locale?: string
          office_id?: string | null
          role_id: string
          team_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          display_name?: string
          email?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          leaving_since?: string | null
          leaving_started_by?: string | null
          locale?: string
          office_id?: string | null
          role_id?: string
          team_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_leaving_started_by_fkey"
            columns: ["leaving_started_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_scope_grants: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string | null
          granted_by: string
          id: string
          reason: string | null
          team_id: string | null
          tenant_id: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          granted_by: string
          id?: string
          reason?: string | null
          team_id?: string | null
          tenant_id: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          granted_by?: string
          id?: string
          reason?: string | null
          team_id?: string | null
          tenant_id?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_scope_grants_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_scope_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_scope_grants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_scope_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_scope_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_steps: {
        Row: {
          created_at: string
          created_by: string | null
          default_hours: number | null
          description_ar: string | null
          description_en: string | null
          id: string
          is_active: boolean
          repeats_per_unit: boolean
          review_mode: string
          sort_order: number
          template_id: string
          tenant_id: string
          title_ar: string | null
          title_en: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_hours?: number | null
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          repeats_per_unit?: boolean
          review_mode?: string
          sort_order: number
          template_id: string
          tenant_id: string
          title_ar?: string | null
          title_en: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_hours?: number | null
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          repeats_per_unit?: boolean
          review_mode?: string
          sort_order?: number
          template_id?: string
          tenant_id?: string
          title_ar?: string | null
          title_en?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_workflow_steps_template"
            columns: ["tenant_id", "template_id"]
            isOneToOne: false
            referencedRelation: "workflow_templates"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "workflow_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description_ar: string | null
          description_en: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name_ar: string | null
          name_en: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name_ar?: string | null
          name_en: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name_ar?: string | null
          name_en?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workstreams: {
        Row: {
          campaign_id: string
          code_letters: string | null
          created_at: string
          created_by: string | null
          department_id: string
          id: string
          name: string
          owner_user_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          campaign_id: string
          code_letters?: string | null
          created_at?: string
          created_by?: string | null
          department_id: string
          id?: string
          name: string
          owner_user_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          campaign_id?: string
          code_letters?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string
          id?: string
          name?: string
          owner_user_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workstreams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstreams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstreams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "workstreams_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstreams_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstreams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      audit_event_entities: {
        Row: {
          entity: string | null
          event_count: number | null
          latest_at: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_list_rows: {
        Row: {
          account_manager_name: string | null
          brand_name: string | null
          brief_owner_names: string[] | null
          client_name: string | null
          created_at: string | null
          created_by_name: string | null
          deliverable_tasks_approved: number | null
          deliverable_total: number | null
          department_brief_approved: number | null
          department_brief_total: number | null
          go_live_at: string | null
          id: string | null
          kind: string | null
          name: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          updated_by_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_task_extension_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          approver_id: string | null
          approver_name: string | null
          assignee_id: string | null
          assignee_name: string | null
          attributed_to: Database["public"]["Enums"]["attribution_party"] | null
          campaign_id: string | null
          campaign_name: string | null
          committed_due_at: string | null
          created_at: string | null
          deliverable_due_at: string | null
          deliverable_id: string | null
          deliverable_name: string | null
          department_id: string | null
          event_id: string | null
          event_type: string | null
          forwarded_at: string | null
          from_at: string | null
          go_live_at: string | null
          is_pending: boolean | null
          note: string | null
          owner_id: string | null
          owner_name: string | null
          owner_note: string | null
          owner_step: boolean | null
          plan_due_at: string | null
          reason: string | null
          request_id: string | null
          stage: string | null
          sub_task_id: string | null
          task_status: string | null
          task_title: string | null
          tenant_id: string | null
          to_at: string | null
          viewer_can_decide: boolean | null
          viewer_can_forward: boolean | null
          viewer_can_request: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverables_owner_user_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_sla_events_sub_task_tenant"
            columns: ["tenant_id", "sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "sla_events_actor_user_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_events_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_events_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "sla_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "sub_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_task_extension_requests: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          approver_id: string | null
          approver_name: string | null
          assignee_id: string | null
          assignee_name: string | null
          attributed_to: Database["public"]["Enums"]["attribution_party"] | null
          campaign_id: string | null
          campaign_name: string | null
          committed_due_at: string | null
          created_at: string | null
          deliverable_due_at: string | null
          deliverable_id: string | null
          deliverable_name: string | null
          department_id: string | null
          event_id: string | null
          event_type: string | null
          forwarded_at: string | null
          from_at: string | null
          go_live_at: string | null
          is_pending: boolean | null
          note: string | null
          owner_id: string | null
          owner_name: string | null
          owner_note: string | null
          owner_step: boolean | null
          plan_due_at: string | null
          reason: string | null
          request_id: string | null
          stage: string | null
          sub_task_id: string | null
          task_status: string | null
          task_title: string | null
          tenant_id: string | null
          to_at: string | null
          viewer_can_decide: boolean | null
          viewer_can_forward: boolean | null
          viewer_can_request: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverables_owner_user_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_sla_events_sub_task_tenant"
            columns: ["tenant_id", "sub_task_id"]
            isOneToOne: false
            referencedRelation: "sub_tasks"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "sla_events_actor_user_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_events_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_events_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "task_list_waiting"
            referencedColumns: ["deliverable_id"]
          },
          {
            foreignKeyName: "sla_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_list_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streams_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "unassigned_work_by_campaign"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "sub_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_tasks_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      task_list_waiting: {
        Row: {
          deliverable_id: string | null
          since: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      unassigned_work_by_campaign: {
        Row: {
          campaign_id: string | null
          campaign_name: string | null
          campaign_status: string | null
          oldest_at: string | null
          tenant_id: string | null
          unassigned_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_campaign_deliverable: {
        Args: {
          p_campaign: string
          p_due_at?: string
          p_due_override?: Json
          p_name: string
          p_owner: string
          p_phase?: string
          p_quantity?: number
          p_type?: string
          p_workstream?: string
        }
        Returns: string
      }
      add_language: { Args: { p_label: string }; Returns: string }
      amendment_summary: {
        Args: { p_month?: string }
        Returns: {
          amendments: number
          hours: number
          id: string
          level: string
          name: string
        }[]
      }
      answer_change_request: {
        Args: {
          p_answer: string
          p_date?: string
          p_request: string
          p_text?: string
        }
        Returns: undefined
      }
      answer_deliverable_change: {
        Args: {
          p_answer: string
          p_ask: string
          p_due_day?: string
          p_hours?: number
          p_note?: string
        }
        Returns: Json
      }
      answer_more_time: {
        Args: { p_ask: string; p_give: boolean; p_note?: string }
        Returns: {
          outcome: string
          past_piece_due: boolean
          reschedule_needed: boolean
          sub_task_id: string
        }[]
      }
      answer_task_request: {
        Args: {
          p_answer: string
          p_assignee?: string
          p_due_at?: string
          p_hours?: number
          p_note?: string
          p_request: string
          p_starts_at?: string
        }
        Returns: {
          deliverable_id: string
          outcome: string
          reschedule_needed: boolean
          sub_task_id: string
        }[]
      }
      answer_too_much: {
        Args: { p_answer: string; p_message: string }
        Returns: undefined
      }
      apply_workflow_template: {
        Args: { p_deliverable: string; p_template?: string }
        Returns: number
      }
      approve_campaign: { Args: { p_campaign: string }; Returns: undefined }
      approve_deliverable_tasks: {
        Args: { p_deliverable: string }
        Returns: undefined
      }
      approve_department_brief: {
        Args: { p_brief: string }
        Returns: undefined
      }
      ask_deliverable_change: {
        Args: {
          p_deliverable: string
          p_due_day?: string
          p_from_sub_task?: string
          p_hours?: number
          p_kinds: string[]
          p_reason: string
        }
        Returns: string
      }
      ask_more_time: {
        Args: { p_note?: string; p_sub_task: string; p_to_day: string }
        Returns: string
      }
      ask_question: {
        Args: {
          p_body: string
          p_deliverable: string
          p_recipients: string[]
          p_sub_task: string
        }
        Returns: string
      }
      assignable_deliverables: {
        Args: { p_campaign: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      assignment_request_approvers: {
        Args: { p_resource: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      attach_job_to_campaign: {
        Args: { p_draft_campaign: string; p_target_campaign: string }
        Returns: string
      }
      attendance_deviation: {
        Args: { p_date: string; p_user: string }
        Returns: {
          late: boolean
          missing: boolean
          no_checkout: boolean
          short: boolean
          suppressed: boolean
        }[]
      }
      attendance_end_day: { Args: never; Returns: undefined }
      attendance_heartbeat: { Args: never; Returns: undefined }
      attendance_start_day: { Args: never; Returns: undefined }
      campaign_concept_mark_item: {
        Args: { p_action: string; p_concept: string; p_item_id: string }
        Returns: undefined
      }
      can_approve_tasks: {
        Args: { d: Database["public"]["Tables"]["deliverables"]["Row"] }
        Returns: boolean
      }
      can_manage_conversation_members: {
        Args: { p_context_id: string; p_context_type: string }
        Returns: boolean
      }
      can_read_conversation: {
        Args: { p_context_id: string; p_context_type: string }
        Returns: boolean
      }
      change_deliverable_type: {
        Args: { p_deliverable: string; p_type: string }
        Returns: Json
      }
      close_change_request: { Args: { p_request: string }; Returns: undefined }
      close_out_campaign: { Args: { p_campaign: string }; Returns: undefined }
      complete_campaign_draft: {
        Args: {
          p_brief: Json
          p_campaign: string
          p_deliverables: Json
          p_go_live: string
          p_phases?: Json
          p_workstreams?: Json
        }
        Returns: string
      }
      conversation_people: {
        Args: { p_context_id: string; p_context_type: string }
        Returns: {
          display_name: string
          reason: string
          subjects: string[]
          total: number
          user_id: string
        }[]
      }
      create_adhoc_deliverable: {
        Args: {
          p_assignee: string
          p_due_at: string
          p_hours: number
          p_reviewer?: string
          p_starts_at: string
          p_title: string
        }
        Returns: {
          deliverable_id: string
          sub_task_id: string
        }[]
      }
      create_campaign_from_brief: {
        Args: {
          p_account_manager?: string
          p_brand: string
          p_brief: Json
          p_client: string
          p_deliverables: Json
          p_go_live: string
          p_kind?: string
          p_name: string
          p_phases?: Json
          p_workstreams?: Json
        }
        Returns: string
      }
      create_internal_project: {
        Args: {
          p_deliverables?: Json
          p_department?: string
          p_name: string
          p_owner_kind: string
          p_pm?: string
          p_team?: string
        }
        Returns: string
      }
      decide_assignment_request: {
        Args: { p_approve: boolean; p_reason?: string; p_request: string }
        Returns: {
          deliverable_id: string
          outcome: string
          reschedule_needed: boolean
          sub_task_id: string
        }[]
      }
      delete_campaign_phase: { Args: { p_phase: string }; Returns: undefined }
      deliver_deliverable_version: {
        Args: { p_media_record: string }
        Returns: string
      }
      deliverable_due_at_change: {
        Args: {
          p_deliverable: string
          p_due_day: string
          p_evidence_asset: string
          p_note?: string
        }
        Returns: string
      }
      deliverable_is_started: {
        Args: { p_deliverable: string }
        Returns: boolean
      }
      department_brief_approvers: {
        Args: { p_campaign: string }
        Returns: {
          department_id: string
          display_name: string
          is_assigned_owner: boolean
          user_id: string
        }[]
      }
      discard_campaign_draft: {
        Args: { p_campaign: string }
        Returns: undefined
      }
      edit_piece_directly: {
        Args: { p_deliverable: string; p_due_day?: string; p_quantity?: number }
        Returns: Json
      }
      effective_sla: { Args: { p_sub_task: string }; Returns: number }
      escalate_unassigned_jobs: { Args: never; Returns: number }
      escalation_rules_reaching_nobody: {
        Args: never
        Returns: {
          fell_back: number
          kind: string
          last_at: string
          reasons: string[]
          unreached: number
        }[]
      }
      forward_extension: {
        Args: { p_note?: string; p_request: string }
        Returns: string
      }
      hand_over_item: {
        Args: {
          p_item: string
          p_kind: string
          p_reviewers?: Json
          p_to: string
        }
        Returns: Json
      }
      handover_items: {
        Args: { p_user: string }
        Returns: {
          context: string
          detail: Json
          item_id: string
          kind: string
          label: string
        }[]
      }
      has_permission: {
        Args: { p_action: string; p_resource: string }
        Returns: boolean
      }
      kpi_rollup: {
        Args: { p_end: string; p_start: string }
        Returns: {
          actual: number
          kpi_definition_id: string
          scope_id: string
          scope_kind: string
          target: number
        }[]
      }
      leaving_people: {
        Args: never
        Returns: {
          department: string
          items: Json
          items_remaining: number
          leaving_since: string
          name: string
          started_by_name: string
          user_id: string
        }[]
      }
      library_add_link: {
        Args: {
          p_expires_on?: string
          p_folder: string
          p_name: string
          p_url: string
        }
        Returns: string
      }
      library_add_link_version: {
        Args: { p_asset: string; p_expires_on?: string; p_url: string }
        Returns: number
      }
      library_add_version: {
        Args: {
          p_asset: string
          p_content_type: string
          p_duration?: number
          p_object_key: string
          p_size: number
          p_thumb_object_key?: string
        }
        Returns: number
      }
      library_archive_due_items: {
        Args: { p_limit?: number; p_tenant: string }
        Returns: {
          asset_id: string
          campaign_id: string
          item_id: string
          item_type: string
          object_key: string
          size_bytes: number
          version: number
        }[]
      }
      library_archive_mark: {
        Args: { p_item_id: string; p_item_type: string; p_ref: string }
        Returns: boolean
      }
      library_bring_back: { Args: { p_asset: string }; Returns: string }
      library_bring_back_done: {
        Args: { p_error?: string; p_ok: boolean; p_request: string }
        Returns: undefined
      }
      library_bring_back_pending: {
        Args: { p_limit?: number }
        Returns: {
          asset_id: string
          items: Json
          request_id: string
          requested_by: string
          tenant_id: string
        }[]
      }
      library_brought_back_clear: {
        Args: { p_asset: string }
        Returns: undefined
      }
      library_brought_back_expired: {
        Args: { p_limit?: number }
        Returns: {
          asset_id: string
          object_keys: string[]
        }[]
      }
      library_can_add: { Args: { p_folder: string }; Returns: boolean }
      library_can_change: { Args: { p_client: string }; Returns: boolean }
      library_client_overview: { Args: { p_client: string }; Returns: Json }
      library_clients: {
        Args: never
        Returns: {
          can_change: boolean
          file_count: number
          id: string
          name: string
        }[]
      }
      library_copy_record: {
        Args: {
          p_asset: string
          p_folder: string
          p_object_key: string
          p_thumb_object_key?: string
        }
        Returns: string
      }
      library_delete: { Args: { p_asset: string }; Returns: undefined }
      library_find_by_name: {
        Args: { p_folder: string; p_name: string }
        Returns: {
          current_version: number
          id: string
        }[]
      }
      library_folder: { Args: { p_folder: string }; Returns: Json }
      library_make_current: {
        Args: { p_asset: string; p_version: number }
        Returns: number
      }
      library_move: {
        Args: { p_asset: string; p_folder: string }
        Returns: undefined
      }
      library_move_folder: {
        Args: { p_folder: string; p_parent: string }
        Returns: undefined
      }
      library_piece_folders: { Args: { p_folder: string }; Returns: Json }
      library_recently_deleted: {
        Args: { p_client: string }
        Returns: {
          content_type: string
          deleted_at: string
          deleted_by_name: string
          folder_path: string
          id: string
          link_url: string
          name: string
          purge_on: string
        }[]
      }
      library_rename: {
        Args: { p_asset: string; p_base: string }
        Returns: string
      }
      library_rename_folder: {
        Args: { p_folder: string; p_name: string }
        Returns: undefined
      }
      library_restore: { Args: { p_asset: string }; Returns: undefined }
      library_search: {
        Args: { p_client?: string; p_kind?: string; p_query: string }
        Returns: {
          client_id: string
          client_name: string
          content_type: string
          folder_id: string
          id: string
          kind_bucket: string
          link_url: string
          name: string
          path: string
          size_bytes: number
          updated_at: string
        }[]
      }
      library_search_counts: {
        Args: { p_client?: string; p_query: string }
        Returns: {
          kind_bucket: string
          n: number
        }[]
      }
      library_sweep_link_notices: {
        Args: { p_dry_run?: boolean }
        Returns: {
          asset_id: string
          expires_on: string
          name: string
          user_id: string
        }[]
      }
      library_sweep_purge_confirm: {
        Args: { p_asset: string }
        Returns: boolean
      }
      library_sweep_purge_due: {
        Args: { p_limit?: number }
        Returns: {
          asset_id: string
          object_keys: string[]
          tenant_id: string
        }[]
      }
      library_usage: {
        Args: { p_asset: string }
        Returns: {
          campaign_name: string
          deliverable_id: string
          piece_name: string
        }[]
      }
      library_versions: {
        Args: { p_asset: string }
        Returns: {
          content_type: string
          created_at: string
          has_file: boolean
          link_url: string
          note: string
          review_note: string
          size_bytes: number
          uploaded_by_name: string
          version: number
        }[]
      }
      mark_task_seen: { Args: { p_task: string }; Returns: undefined }
      may_generate_department_brief: {
        Args: { p_campaign: string; p_department: string }
        Returns: string
      }
      move_deliverable_to_phase: {
        Args: { p_deliverable: string; p_phase: string }
        Returns: undefined
      }
      move_deliverable_to_workstream: {
        Args: { p_deliverable: string; p_workstream: string }
        Returns: undefined
      }
      my_conversations: {
        Args: never
        Returns: {
          campaign_id: string
          campaign_name: string
          context_id: string
          context_type: string
          conversation_id: string
          is_archived: boolean
          last_message_at: string
          title: string
          unread: number
        }[]
      }
      my_pending_approvals: {
        Args: never
        Returns: {
          campaign_id: string
          campaign_name: string
          deliverable_id: string
          department: string
          id: string
          kind: string
          since: string
          target_id: string
          title: string
        }[]
      }
      my_permissions: {
        Args: never
        Returns: {
          action: string
          resource: string
        }[]
      }
      my_scope_grants: {
        Args: never
        Returns: {
          department_id: string
          team_id: string
        }[]
      }
      needs_me_blocks: {
        Args: never
        Returns: {
          awaited_from: string
          deliverable_id: string
          deliverable_name: string
          description: string
          input_id: string
          kind: string
          maker_id: string
          maker_name: string
          requested_at: string
          sub_task_id: string
          task_title: string
        }[]
      }
      needs_me_change_requests: {
        Args: never
        Returns: {
          answered_at: string
          answered_by: string
          answered_by_name: string
          asked_by: string
          campaign_id: string
          campaign_name: string
          changes: Json
          cost: Json
          counter_date: string
          counter_text: string
          created_at: string
          decline_reason: string
          deliverable_id: string
          deliverable_name: string
          id: string
          my_part: string
          requested_by: string
          requested_by_name: string
          status: string
        }[]
      }
      needs_me_escalations: {
        Args: never
        Returns: {
          context_label: string
          detail: Json
          entity_id: string
          entity_type: string
          escalated_at: string
          kind: string
          label: string
          notification_id: string
        }[]
      }
      needs_me_extensions: {
        Args: never
        Returns: {
          assignee_id: string
          attributed_to: string
          campaign_id: string
          campaign_name: string
          deliverable_id: string
          deliverable_name: string
          forwarded_at: string
          from_at: string
          owner_note: string
          reason: string
          request_id: string
          requested_at: string
          requested_by: string
          requested_by_name: string
          stage: string
          sub_task_id: string
          task_title: string
          to_at: string
        }[]
      }
      needs_me_messages: {
        Args: never
        Returns: {
          author_id: string
          author_name: string
          body: string
          created_at: string
          deliverable_id: string
          deliverable_name: string
          id: string
          kind: string
          label: string
          sub_task_id: string
        }[]
      }
      needs_me_overload: {
        Args: never
        Returns: {
          booked_hours: number
          department_id: string
          name: string
          nominal_hours: number
          over_capacity_pct: number
          resource_id: string
          team_id: string
          user_id: string
          util_pct: number
          week_start: string
        }[]
      }
      notify_resource_clash: {
        Args: { p_resource: string; p_sub_task: string }
        Returns: number
      }
      nudge: {
        Args: {
          p_body?: string
          p_deliverable: string
          p_person: string
          p_sub_task: string
        }
        Returns: string
      }
      office_closure_stranded_bookings: {
        Args: { p_closure: string }
        Returns: {
          booking_id: string
          deliverable_id: string
          deliverable_name: string
          ends_at: string
          owner_name: string
          owner_user_id: string
          resource_id: string
          resource_name: string
          starts_at: string
          sub_task_id: string
          title: string
        }[]
      }
      owner_decline_extension: {
        Args: { p_reason: string; p_request: string }
        Returns: string
      }
      power_admin_emails: { Args: never; Returns: string[] }
      preview_deliverable_type_change: {
        Args: { p_deliverable: string; p_type: string }
        Returns: Json
      }
      preview_quantity_change: {
        Args: { p_deliverable: string; p_quantity: number }
        Returns: Json
      }
      promote_delivered_version_to_final: {
        Args: { p_media_record: string }
        Returns: string
      }
      promote_single_job: { Args: { p_campaign: string }; Returns: undefined }
      reassign_deliverable: {
        Args: { p_deliverable: string; p_owner: string }
        Returns: undefined
      }
      record_due_date_override: {
        Args: {
          p_boundary?: string
          p_boundary_day?: string
          p_capacity_hours?: number
          p_days_left: number
          p_deliverable: string
          p_due_day: string
          p_go_live_day: string
          p_outstanding_hours?: number
          p_required_days: number
          p_severity: string
        }
        Returns: string
      }
      remove_sub_task: { Args: { p_sub_task: string }; Returns: string }
      remove_workstream: { Args: { p_workstream: string }; Returns: undefined }
      rename_campaign: {
        Args: { p_campaign: string; p_name: string }
        Returns: string
      }
      rename_deliverable: {
        Args: { p_deliverable: string; p_name: string }
        Returns: undefined
      }
      reopen_campaign: { Args: { p_campaign: string }; Returns: undefined }
      reopen_deliverable: {
        Args: {
          p_deliverable: string
          p_due_at: string
          p_hours?: number
          p_kind?: string
          p_reason: string
          p_reviewers?: Json
          p_tasks: string[]
        }
        Returns: Json
      }
      reopen_department_brief: { Args: { p_brief: string }; Returns: undefined }
      reopen_task: {
        Args: {
          p_due_at: string
          p_hours?: number
          p_kind?: string
          p_reason: string
          p_reviewers?: Json
          p_sub_task: string
        }
        Returns: Json
      }
      reopenable_deliverables: {
        Args: { p_campaign: string }
        Returns: string[]
      }
      reply_to_question: {
        Args: { p_body: string; p_question: string }
        Returns: string
      }
      request_deliverable_change: {
        Args: {
          p_asked_by: string
          p_changes: Json
          p_cost?: Json
          p_deliverable: string
          p_evidence_asset?: string
        }
        Returns: string
      }
      request_task_booking: {
        Args: {
          p_assignee?: string
          p_due_at?: string
          p_hours?: number
          p_needed_by?: string
          p_note?: string
          p_starts_at?: string
          p_sub_task: string
          p_team: string
        }
        Returns: string
      }
      resequence_deliverable_tasks: {
        Args: { p_deliverable: string; p_ordered_ids: string[] }
        Returns: number
      }
      resolve_change_request: {
        Args: { p_request: string; p_resolution: string }
        Returns: undefined
      }
      run_escalation_sweep: { Args: { p_dry_run?: boolean }; Returns: Json }
      run_escalation_sweep_for: {
        Args: { p_deliverable: string }
        Returns: Json
      }
      save_campaign_phase: {
        Args: {
          p_campaign: string
          p_ends_on: string
          p_name: string
          p_phase: string
          p_starts_on: string
        }
        Returns: string
      }
      save_sub_task: {
        Args: {
          p_assignee?: string
          p_deliverable: string
          p_department?: string
          p_description?: string
          p_due_at?: string
          p_review_mode?: string
          p_reviewers: Json
          p_sla_hours?: number
          p_sla_profile?: string
          p_starts_at?: string
          p_status?: string
          p_sub_task: string
          p_team?: string
          p_title: string
        }
        Returns: string
      }
      save_workstream: {
        Args: {
          p_campaign: string
          p_code_letters?: string
          p_department: string
          p_name: string
          p_owner?: string
          p_workstream?: string
        }
        Returns: string
      }
      say_too_much: {
        Args: { p_note?: string; p_task: string }
        Returns: string
      }
      seed_tenant_roles: { Args: { p_tenant: string }; Returns: undefined }
      set_campaign_account_manager: {
        Args: { p_campaign: string; p_user: string }
        Returns: undefined
      }
      set_campaign_phases: {
        Args: { p_campaign: string; p_enabled: boolean }
        Returns: undefined
      }
      set_department_default_brief: {
        Args: { p_department: string; p_template: string }
        Returns: undefined
      }
      similar_open_jobs: {
        Args: { p_client: string; p_exclude_campaign?: string; p_title: string }
        Returns: {
          campaign_id: string
          deliverable_count: number
          department_names: string[]
          kind: string
          name: string
          raised_at: string
          raised_by: string
          score: number
          status: string
        }[]
      }
      start_campaign_draft: {
        Args: {
          p_account_manager?: string
          p_brand: string
          p_client: string
          p_kind?: string
          p_name: string
        }
        Returns: string
      }
      start_deactivation: { Args: { p_user: string }; Returns: Json }
      sub_task_approve: { Args: { p_sub_task: string }; Returns: undefined }
      sub_task_cancel: { Args: { p_sub_task: string }; Returns: undefined }
      sub_task_extension_decide: {
        Args: {
          p_approve: boolean
          p_note?: string
          p_request: string
          p_to_day?: string
        }
        Returns: string
      }
      sub_task_extension_request: {
        Args: {
          p_attributed_to: string
          p_reason: string
          p_sub_task: string
          p_to_day: string
        }
        Returns: string
      }
      sub_task_extension_withdraw: {
        Args: { p_request: string }
        Returns: string
      }
      sub_task_reinstate: {
        Args: { p_assigning?: boolean; p_sub_task: string }
        Returns: undefined
      }
      sub_task_request_changes: {
        Args: { p_sub_task: string }
        Returns: undefined
      }
      sub_task_respond: { Args: { p_sub_task: string }; Returns: undefined }
      sub_task_response_kind: { Args: { p_sub_task: string }; Returns: string }
      sub_task_start: { Args: { p_id: string }; Returns: undefined }
      sub_task_submit: {
        Args: {
          p_accept_untimed?: boolean
          p_id: string
          p_manual_minutes?: number
        }
        Returns: undefined
      }
      take_task_offer: {
        Args: { p_request: string }
        Returns: {
          deliverable_id: string
          outcome: string
          reschedule_needed: boolean
          sub_task_id: string
        }[]
      }
      task_round_timing: {
        Args: { p_sub_task: string }
        Returns: {
          allocated_hours: number
          blocked_minutes_so_far: number
          elapsed_minutes: number
          is_untimed: boolean
          round: number
          started_at: string
          status: string
          sub_task_id: string
          threshold_minutes: number
        }[]
      }
      unassign_task: {
        Args: { p_confirm_started?: boolean; p_sub_task: string }
        Returns: Json
      }
      update_campaign_brief: {
        Args: { p_brief: Json; p_campaign: string }
        Returns: undefined
      }
      update_campaign_deliverable: {
        Args: {
          p_deliverable: string
          p_name: string
          p_quantity: number
          p_type: string
        }
        Returns: undefined
      }
      update_campaign_draft: {
        Args: {
          p_account_manager?: string
          p_brand: string
          p_brief?: Json
          p_campaign: string
          p_go_live?: string
          p_name: string
        }
        Returns: undefined
      }
      update_piece_details: {
        Args: {
          p_channel: string
          p_deliverable: string
          p_languages: string[]
          p_notes: string
        }
        Returns: undefined
      }
      update_single_job_brief: {
        Args: { p_campaign: string; p_values: Json }
        Returns: undefined
      }
      update_task_assignment: {
        Args: {
          p_assignee: string
          p_confirm_started?: boolean
          p_due_at?: string
          p_hours?: number
          p_review_mode?: string
          p_reviewers?: Json
          p_starts_at?: string
          p_sub_task: string
          p_title: string
        }
        Returns: {
          deliverable_id: string
          outcome: string
          request_id: string
          reschedule_needed: boolean
          sub_task_id: string
        }[]
      }
      users_holding_permission: {
        Args: { p_action: string; p_resource: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      view_as_options: { Args: never; Returns: Json }
      view_as_pre_request: { Args: never; Returns: undefined }
      view_as_start: { Args: { p_user: string }; Returns: Json }
      withdraw_assignment_request: {
        Args: { p_request: string }
        Returns: undefined
      }
      withdraw_deliverable_change: {
        Args: { p_ask: string }
        Returns: undefined
      }
      withdraw_more_time: { Args: { p_ask: string }; Returns: undefined }
    }
    Enums: {
      attribution_party: "assignee" | "client" | "dependency" | "approver"
      booking_state:
        | "soft_hold"
        | "tentative"
        | "confirmed"
        | "cancelled"
        | "expired"
      capacity_model: "exclusive" | "pooled" | "load_based"
      deliverable_attribute:
        | "channel"
        | "format"
        | "orientation"
        | "production_type"
        | "complexity"
        | "client_approval"
        | "language"
      deliverable_state:
        | "draft"
        | "in_progress"
        | "in_review"
        | "approved"
        | "delivered"
        | "archived"
        | "blocked"
      feedback_category: "bug" | "idea" | "other"
      feedback_status: "open" | "resolved"
      resource_kind: "human" | "equipment" | "room"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      attribution_party: ["assignee", "client", "dependency", "approver"],
      booking_state: [
        "soft_hold",
        "tentative",
        "confirmed",
        "cancelled",
        "expired",
      ],
      capacity_model: ["exclusive", "pooled", "load_based"],
      deliverable_attribute: [
        "channel",
        "format",
        "orientation",
        "production_type",
        "complexity",
        "client_approval",
        "language",
      ],
      deliverable_state: [
        "draft",
        "in_progress",
        "in_review",
        "approved",
        "delivered",
        "archived",
        "blocked",
      ],
      feedback_category: ["bug", "idea", "other"],
      feedback_status: ["open", "resolved"],
      resource_kind: ["human", "equipment", "room"],
    },
  },
} as const

