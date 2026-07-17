import Descriptions from "antd/es/descriptions";
import Empty from "antd/es/empty";
import Space from "antd/es/space";
import Tag from "antd/es/tag";
import Typography from "antd/es/typography";
import type { DomElementInfo } from "../../shared/dom";

interface ElementDetailsProps {
  element?: DomElementInfo;
}

export function ElementDetails({ element }: ElementDetailsProps) {
  if (!element) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未选择元素" />;
  }

  return (
    <Space direction="vertical" size={12} className="full-width">
      <Space wrap>
        <Tag color="blue">{element.tagName}</Tag>
        {element.id ? <Tag color="cyan">#{element.id}</Tag> : null}
        {element.className ? <Tag color="green">.{element.className.split(" ").slice(0, 2).join(".")}</Tag> : null}
      </Space>

      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label="selector">
          <Typography.Text code copyable>
            {element.selector}
          </Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="rect">
          {Math.round(element.rect.width)} x {Math.round(element.rect.height)} @ {Math.round(element.rect.left)},{" "}
          {Math.round(element.rect.top)}
        </Descriptions.Item>
        <Descriptions.Item label="text">
          <Typography.Paragraph className="code-block" ellipsis={{ rows: 4, expandable: true }}>
            {element.text || "-"}
          </Typography.Paragraph>
        </Descriptions.Item>
      </Descriptions>

      <Typography.Text strong>computedStyle</Typography.Text>
      <pre className="json-view">{JSON.stringify(element.computedStyle, null, 2)}</pre>

      <Typography.Text strong>outerHTML</Typography.Text>
      <pre className="json-view">{element.outerHTML}</pre>
    </Space>
  );
}
