-- Atomic cleanup used after a project archive has been written and verified on NAS.
-- The function deletes all project-owned rows in one transaction and returns
-- storage keys that are no longer referenced by any remaining project.

CREATE OR REPLACE FUNCTION archive_clear_project_data(
  p_project_id VARCHAR,
  p_user_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_storage_keys JSONB;
  v_candidate_keys TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM projects
    WHERE id = p_project_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION '项目不存在或无权限';
  END IF;

  SELECT array_agg(DISTINCT key)
  INTO v_candidate_keys
  FROM (
    SELECT image_key AS key
    FROM image_records
    WHERE project_id = p_project_id AND user_id = p_user_id AND image_key IS NOT NULL
    UNION
    SELECT edited_image_key AS key
    FROM image_records
    WHERE project_id = p_project_id AND user_id = p_user_id AND edited_image_key IS NOT NULL
    UNION
    SELECT image_key AS key
    FROM reference_images
    WHERE project_id = p_project_id AND user_id = p_user_id AND image_key IS NOT NULL
    UNION
    SELECT key AS key
    FROM design_assets
    WHERE project_id = p_project_id AND user_id = p_user_id AND key IS NOT NULL
    UNION
    SELECT version.key AS key
    FROM asset_versions version
    JOIN design_assets asset ON asset.id = version.asset_id
    WHERE asset.project_id = p_project_id AND version.user_id = p_user_id AND version.key IS NOT NULL
    UNION
    SELECT image_key AS key
    FROM inspiration_items
    WHERE project_id = p_project_id AND user_id = p_user_id AND image_key IS NOT NULL
    UNION
    SELECT image_key AS key
    FROM archived_images
    WHERE project_id = p_project_id AND user_id = p_user_id AND image_key IS NOT NULL
  ) candidates;

  DELETE FROM image_tags
  WHERE image_id IN (
    SELECT id FROM image_records
    WHERE project_id = p_project_id AND user_id = p_user_id
  );

  DELETE FROM asset_versions
  WHERE user_id = p_user_id
    AND asset_id IN (
      SELECT id FROM design_assets
      WHERE project_id = p_project_id AND user_id = p_user_id
    );

  DELETE FROM design_layers
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM design_operations
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM design_assets
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM inspiration_items
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM inspiration_folders
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM canvas_blocks
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM image_records
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM chat_messages
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM reference_images
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM prompt_library
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM custom_skills
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM archived_images
  WHERE project_id = p_project_id AND user_id = p_user_id;

  DELETE FROM projects
  WHERE id = p_project_id AND user_id = p_user_id;

  SELECT COALESCE(jsonb_agg(key ORDER BY key), '[]'::jsonb)
  INTO v_storage_keys
  FROM unnest(COALESCE(v_candidate_keys, ARRAY[]::TEXT[])) AS candidate(key)
  WHERE candidate.key IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM image_records
      WHERE user_id = p_user_id
        AND (image_key = candidate.key OR edited_image_key = candidate.key)
    )
    AND NOT EXISTS (
      SELECT 1 FROM reference_images
      WHERE user_id = p_user_id AND image_key = candidate.key
    )
    AND NOT EXISTS (
      SELECT 1 FROM design_assets
      WHERE user_id = p_user_id AND key = candidate.key
    )
    AND NOT EXISTS (
      SELECT 1 FROM asset_versions
      WHERE user_id = p_user_id AND key = candidate.key
    )
    AND NOT EXISTS (
      SELECT 1 FROM inspiration_items
      WHERE user_id = p_user_id AND image_key = candidate.key
    )
    AND NOT EXISTS (
      SELECT 1 FROM archived_images
      WHERE user_id = p_user_id AND image_key = candidate.key
    );

  RETURN jsonb_build_object('storageKeys', v_storage_keys);
END;
$$;

GRANT EXECUTE ON FUNCTION archive_clear_project_data(VARCHAR, VARCHAR) TO service_role;
