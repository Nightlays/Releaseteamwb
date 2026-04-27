#!/usr/bin/env python3
import argparse
import base64
import json
import pathlib
import tempfile
import urllib.request
import urllib.parse
from collections import Counter
from datetime import UTC, datetime

import onnx
from onnx import TensorProto, helper
from catboost import CatBoostClassifier, Pool


FEATURE_KEYS = [
    "tc_total",
    "tc_total_delta",
    "tc_total_delta_pct",
    "tc_volatility",
    "tc_slope_pct",
    "cov_swat_delta_pct",
    "cov_stream_delta_pct",
    "sel_swat_delta_pct",
    "sel_stream_delta_pct",
    "avg_total_delta",
    "chp_total_delta_pct",
    "chp_ios_delta_pct",
    "chp_android_delta_pct",
    "release_anoms",
    "type_anoms",
    "platform_anoms",
    "anom_score",
]

DEFAULT_DATASET_URL = (
    "https://script.google.com/macros/s/"
    "AKfycby1MNW_-mbMh8ukBs94kOc0KXM43yZae7gmCgSLoK9a4Tx3F0JY4lMdQHoWhxyJ1j1XYQ/"
    "exec?op=get&name=wb_graphs_v0_2_9_ml_dataset.json"
)
DEFAULT_DRIVE_EXEC_URL = DEFAULT_DATASET_URL.split("?", 1)[0]
DRIVE_BUNDLE_FILE = "wb_graphs_v0_2_9_catboost_bundle.json"
DRIVE_META_FILE = "wb_graphs_v0_2_9_catboost_meta.json"
DRIVE_MANIFEST_FILE = "wb_graphs_v0_2_9_catboost_manifest.json"


def normalize_entry(entry, index=0):
    if not isinstance(entry, dict):
        return None
    features = entry.get("features")
    if not isinstance(features, dict):
        return None
    label = entry.get("label")
    if label not in ("ok", "fail"):
        return None
    normalized = {
        "id": str(entry.get("id") or f"ml_entry_{index}"),
        "time": str(entry.get("time") or ""),
        "label": label,
        "labeledAt": str(entry.get("labeledAt") or ""),
        "features": {key: float(features.get(key) or 0.0) for key in FEATURE_KEYS},
    }
    return normalized


def load_dataset(path_or_url):
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        raw = urllib.request.urlopen(path_or_url, timeout=30).read().decode("utf-8")
    else:
        raw = pathlib.Path(path_or_url).read_text(encoding="utf-8")
    payload = json.loads(raw)
    data = []
    for index, item in enumerate(payload if isinstance(payload, list) else []):
        row = normalize_entry(item, index)
        if row:
            data.append(row)
    return data


def drive_save_json(exec_url, file_name, payload):
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        f"{exec_url}?name={urllib.parse.quote(file_name)}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        response.read()


def train_model(dataset):
    x = [[row["features"][key] for key in FEATURE_KEYS] for row in dataset]
    y = [1 if row["label"] == "fail" else 0 for row in dataset]
    label_counts = Counter(y)
    model = CatBoostClassifier(
        loss_function="Logloss",
        eval_metric="Logloss",
        iterations=120,
        depth=3,
        learning_rate=0.05,
        l2_leaf_reg=8.0,
        random_seed=42,
        verbose=False,
        border_count=32,
        auto_class_weights="Balanced",
    )
    pool = Pool(x, y, feature_names=FEATURE_KEYS)
    model.fit(pool)
    return model, x, y, label_counts


def compute_metrics(probs, y_true, threshold=0.5):
    preds = [1 if p >= threshold else 0 for p in probs]
    tp = sum(1 for p, y in zip(preds, y_true) if p == 1 and y == 1)
    tn = sum(1 for p, y in zip(preds, y_true) if p == 0 and y == 0)
    fp = sum(1 for p, y in zip(preds, y_true) if p == 1 and y == 0)
    fn = sum(1 for p, y in zip(preds, y_true) if p == 0 and y == 1)
    total = max(1, len(y_true))
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    accuracy = (tp + tn) / total
    balanced_accuracy = ((tp / max(1, tp + fn)) + (tn / max(1, tn + fp))) / 2
    return {
        "accuracy": accuracy,
        "balanced_accuracy": balanced_accuracy,
        "precision_fail": precision,
        "recall_fail": recall,
        "confusion": {"tp": tp, "tn": tn, "fp": fp, "fn": fn},
    }


def export_model_bundle(model, output_dir, dataset, label_counts):
    output_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = output_dir / "catboost_release_risk.onnx"
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_model_path = pathlib.Path(tmpdir) / "catboost_release_risk.onnx"
        model.save_model(
            str(tmp_model_path),
            format="onnx",
            export_parameters={
                "onnx_domain": "wb.ml.release",
                "onnx_model_version": 1,
                "onnx_doc_string": "WB release risk CatBoost classifier",
                "onnx_graph_name": "wb_release_risk",
            },
        )
        raw_model = onnx.load(str(tmp_model_path))
        zipmap_nodes = [node for node in raw_model.graph.node if node.op_type == "ZipMap"]
        if zipmap_nodes:
            zipmap_output = zipmap_nodes[0].output[0]
            probability_input = zipmap_nodes[0].input[0]
            kept_nodes = [node for node in raw_model.graph.node if node.op_type != "ZipMap"]
            del raw_model.graph.node[:]
            raw_model.graph.node.extend(kept_nodes)
            kept_outputs = [output for output in raw_model.graph.output if output.name != zipmap_output]
            del raw_model.graph.output[:]
            raw_model.graph.output.extend(kept_outputs)
            raw_model.graph.output.append(
                helper.make_tensor_value_info(probability_input, TensorProto.FLOAT, ["N", 2])
            )
        binary = raw_model.SerializeToString()
    onnx_path.write_bytes(binary)

    onnx_model = onnx.load_model_from_string(binary)
    input_meta = [
        {
            "name": item.name,
            "dims": [int(dim.dim_value) if dim.dim_value else 0 for dim in item.type.tensor_type.shape.dim],
            "elemType": int(item.type.tensor_type.elem_type),
        }
        for item in onnx_model.graph.input
    ]
    output_meta = [
        {
            "name": item.name,
            "dims": [int(dim.dim_value) if dim.dim_value else 0 for dim in item.type.tensor_type.shape.dim],
        }
        for item in onnx_model.graph.output
    ]

    x = [[row["features"][key] for key in FEATURE_KEYS] for row in dataset]
    y = [1 if row["label"] == "fail" else 0 for row in dataset]
    probs = [float(p[1]) for p in model.predict_proba(x)]
    metrics = compute_metrics(probs, y, threshold=0.5)
    importances = model.get_feature_importance(type="FeatureImportance")
    ranked_features = [
        {"key": key, "importance": round(float(score), 4)}
        for key, score in sorted(zip(FEATURE_KEYS, importances), key=lambda item: item[1], reverse=True)
    ]

    metadata = {
        "modelType": "catboost-onnx",
        "trainedAt": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "featureKeys": FEATURE_KEYS,
        "dataset": {
            "totalRecords": len(dataset),
            "labeledOk": int(label_counts.get(0, 0)),
            "labeledFail": int(label_counts.get(1, 0)),
            "source": DEFAULT_DATASET_URL,
        },
        "threshold": 0.5,
        "trainMetrics": metrics,
        "topFeatures": ranked_features[:8],
        "onnx": {
            "inputs": input_meta,
            "outputs": output_meta,
        },
        "warnings": [],
    }
    if label_counts.get(1, 0) < 5:
        metadata["warnings"].append(
            "В истории мало негативных примеров. Используйте оценку CatBoost как ранний сигнал, а не как окончательный вердикт."
        )
    if len(dataset) < 30:
        metadata["warnings"].append(
            "Обучающая история короткая. Качество модели может заметно измениться после накопления новых размеченных релизов."
        )

    bundle_path = output_dir / "catboost_release_risk.bundle.js"
    payload = {
        "base64": base64.b64encode(binary).decode("ascii"),
        "metadata": metadata,
    }
    bundle_text = (
        "window.WB_CATBOOST_ONNX_MODEL = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    )
    bundle_path.write_text(bundle_text, encoding="utf-8")

    metadata_path = output_dir / "catboost_release_risk.meta.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "model": "catboost-release-risk",
        "version": metadata["trainedAt"],
        "trainedAt": metadata["trainedAt"],
        "bundleName": DRIVE_BUNDLE_FILE,
        "metaName": DRIVE_META_FILE,
        "featureKeys": FEATURE_KEYS,
        "dataset": metadata["dataset"],
    }
    manifest_path = output_dir / "catboost_release_risk.manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return onnx_path, bundle_path, metadata_path, manifest_path, metadata, payload, manifest


def publish_model_artifacts(exec_url, bundle_payload, metadata, manifest):
    drive_save_json(exec_url, DRIVE_BUNDLE_FILE, bundle_payload)
    drive_save_json(exec_url, DRIVE_META_FILE, metadata)
    drive_save_json(exec_url, DRIVE_MANIFEST_FILE, manifest)


def main():
    parser = argparse.ArgumentParser(description="Train CatBoost release risk model and export ONNX bundle.")
    parser.add_argument(
        "--dataset",
        default=DEFAULT_DATASET_URL,
        help="Path or URL to ML dataset JSON",
    )
    parser.add_argument(
        "--output-dir",
        default="ml",
        help="Output directory for generated ONNX assets",
    )
    parser.add_argument(
        "--publish-drive",
        action="store_true",
        help="Publish bundle/meta/manifest to Apps Script Drive storage",
    )
    parser.add_argument(
        "--drive-exec-url",
        default=DEFAULT_DRIVE_EXEC_URL,
        help="Apps Script exec URL for publishing artifacts",
    )
    args = parser.parse_args()

    dataset = load_dataset(args.dataset)
    if len(dataset) < 8:
        raise SystemExit(f"Need at least 8 labeled records, got {len(dataset)}")
    model, x, y, label_counts = train_model(dataset)
    onnx_path, bundle_path, metadata_path, manifest_path, metadata, bundle_payload, manifest = export_model_bundle(
        model, pathlib.Path(args.output_dir), dataset, label_counts
    )
    published = False
    publish_error = ""
    if args.publish_drive:
        try:
            publish_model_artifacts(args.drive_exec_url, bundle_payload, metadata, manifest)
            published = True
        except Exception as exc:
            publish_error = str(exc)

    print(f"Dataset records: {len(dataset)}")
    print(f"Labels: ok={label_counts.get(0, 0)} fail={label_counts.get(1, 0)}")
    print(f"ONNX: {onnx_path}")
    print(f"Bundle: {bundle_path}")
    print(f"Metadata: {metadata_path}")
    print(f"Manifest: {manifest_path}")
    print(f"Published to Drive: {'yes' if published else 'no'}")
    if publish_error:
        print(f"Publish error: {publish_error}")
    print("Train metrics:", json.dumps(metadata["trainMetrics"], ensure_ascii=False))
    print("Top features:", ", ".join(f"{item['key']}={item['importance']}" for item in metadata["topFeatures"]))


if __name__ == "__main__":
    main()
