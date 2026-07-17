import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import Space from "antd/es/space";
import Typography from "antd/es/typography";
import type { ToolLogEntry } from "../types";

interface ToolLogProps {
  entries: ToolLogEntry[];
}

export function ToolLog({ entries }: ToolLogProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="tool-log">
      {entries.slice(0, 5).map((entry) => (
        <div className="tool-log-row" key={entry.id}>
          <Space size={8}>
            {entry.status === "running" ? <LoadingOutlined /> : null}
            {entry.status === "success" ? <CheckCircleOutlined className="status-success" /> : null}
            {entry.status === "error" ? <CloseCircleOutlined className="status-error" /> : null}
            <Typography.Text>{entry.label}</Typography.Text>
          </Space>
          <Typography.Text type="secondary">{entry.detail ?? entry.toolName}</Typography.Text>
        </div>
      ))}
    </div>
  );
}
